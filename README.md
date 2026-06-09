# `@endo/genie` — Docker image

A self-contained Docker image that runs [`@endo/genie`](https://github.com/endojs/endo-but-for-bots/tree/llm/packages/genie)
in a container: its three integration scenarios **and** an interactive REPL to
drive genie by hand, against a live [OpenRouter](https://openrouter.ai) model.

It builds any branch/tag/PR ref via the `REPO_REF` build-arg (defaults to the
`llm` mainline). To exercise **PR #422** (the `genie → @earendil-works` pi
migration), build with `--build-arg REPO_REF=genie-earendil-pi-migration`.

| Mode (`docker run … genie <mode>`) | What it does                                        | Needs API key? |
| ---------------------------------- | --------------------------------------------------- | -------------- |
| `interactive`                      | a live `you>` REPL — **you chat with genie** via `dev-repl.js` | **yes** |
| `integration`                      | boots a real Endo daemon, provisions genie, sends a message, asserts the agent reads a workspace file — **live LLM round-trip** | **yes** |
| `sandbox-slice`                    | same daemon boot, then probes the agent's bwrap slice (bind mount, mount table, host-fs isolation, loopback network) — **live LLM round-trip** | **yes** |
| `dev-repl-sandbox`                 | drives `dev-repl.js` with a **faux scripted LLM** and asserts `bash` runs in the slice | **no** |
| `all`                              | runs the three scenarios in sequence (default)      | live ones skipped without a key |
| `shell`                            | interactive bash shell for debugging                | no |

The live modes need bubblewrap + **unprivileged user namespaces**, which is why
the image runs on *your* Docker host (with the flags below), not inside a
capabilities-restricted container.

---

## 1. Secrets — create the OpenRouter key file on the HOST

The live modes call OpenRouter. Create a key file **outside any directory you
bind-mount into the container**, lock it down, and inject it at run time only:

```sh
mkdir -p ~/secrets
printf 'OPENROUTER_API_KEY=sk-or-...\n' > ~/secrets/openrouter.env
chmod 600 ~/secrets/openrouter.env
```

- Use a **dedicated, revocable** OpenRouter key with a **low credit cap**.
- **Never** paste the key into chat, **never** commit it, **never** bake it into
  the image. The Dockerfile sets no key; `entrypoint.sh` reads
  `OPENROUTER_API_KEY` from the environment, and the only path that puts it
  there is `--env-file` at `docker run` time.
- The default model is the free tier (`qwen/qwen3-coder:free`), so even with a
  key the spend should be ~zero; the cap is belt-and-suspenders.

---

## 2. Build

```sh
# mainline genie (llm)
docker build -t genie .

# PR #422 (genie → @earendil-works pi migration)
docker build --build-arg REPO_REF=genie-earendil-pi-migration -t genie-422 .
```

Build args:

- `REPO_REF` — branch/tag/PR ref to clone (default `llm`).
- `REPO_URL` — repo to clone (default
  `https://github.com/endojs/endo-but-for-bots.git`; point at your own fork if
  the ref lives there).

The build clones the ref, applies `harness-fixes.patch` to the in-image clone
(see § "Known infra fix"), runs `yarn install` + `yarn build`. No tests run at
build time and no key is needed to build.

---

## 3. Run

The genie sandbox slice needs **unprivileged user namespaces**. Two host
postures work; pick the one your security policy allows.

### Simplest — `--privileged`

```sh
docker run --rm -it \
  --privileged \
  --env-file ~/secrets/openrouter.env \
  genie interactive
```

### Lighter — drop only the two confinement layers that block userns

```sh
docker run --rm -it \
  --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined \
  --env-file ~/secrets/openrouter.env \
  genie interactive
```

Why each flag:

- `--env-file ~/secrets/openrouter.env` — injects `OPENROUTER_API_KEY` into the
  container environment at run time only. This is the single channel by which
  the key reaches the image; it never touches the image layers.
- `--privileged` — the blunt instrument: grants the container the capabilities
  and relaxes the seccomp/AppArmor profiles so `bwrap` can `unshare` a user +
  mount namespace. Use it if the lighter pair does not work on your host.
- `--security-opt seccomp=unconfined` — Docker's default seccomp profile blocks
  some namespace/mount syscalls bwrap uses; unconfining it lets bwrap run
  without full `--privileged`.
- `--security-opt apparmor=unconfined` — on Ubuntu/Debian hosts the default
  AppArmor profile (and the newer `userns` restriction) can deny unprivileged
  user-namespace creation; unconfining it removes that block.

If the **host kernel itself** disables unprivileged userns, no container flag
can re-enable it. On the host:

```sh
cat /proc/sys/kernel/unprivileged_userns_clone   # must print 1 (Debian/Ubuntu)
# if 0:
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

### Run modes (the trailing argument)

```sh
docker run ... genie interactive       # YOU chat with genie (key)
docker run ... genie all               # all three scenarios (default)
docker run ... genie dev-repl-sandbox  # faux LLM only — no key needed
docker run ... genie integration       # workspace-tool only (key)
docker run ... genie sandbox-slice     # sandbox-slice only (key)
docker run ... genie shell             # interactive debug shell
```

`dev-repl-sandbox` is the fastest smoke test of the slice wiring and needs no
key:

```sh
docker run --rm -it --privileged genie dev-repl-sandbox
```

### Choosing the model (`--model` / aliases)

Every mode (scenarios **and** interactive) takes a `--model` / `-m` flag — handy
for hopping off a rate-limited free model (`429 Provider returned error`):

```sh
docker run --rm -it --privileged \
  --env-file ~/secrets/openrouter.env \
  genie interactive --model nemotron
```

How the value is interpreted:

- A bare OpenRouter id gets the `openrouter/` prefix:
  `--model qwen/qwen3-coder:free` → `openrouter/qwen/qwen3-coder:free`. (So
  `openai/gpt-oss-120b:free` is the OpenRouter *vendor* `openai`, not the openai
  provider.)
- An explicit provider is kept verbatim: `--model openrouter/...` or
  `--model ollama/...`.
- Short aliases: `qwen`, `llama`, `gptoss`, `deepseek`, `glm`, `nemotron`
  (→ `nvidia/nemotron-3-ultra-550b-a55b:free`).

`-e GENIE_MODEL=<spec>` still works and is equivalent; the flag wins if both are
given. `GENIE_MODEL` is split on its **first** `/` into provider + model id;
`openrouter` is a built-in pi-ai provider that reads `OPENROUTER_API_KEY` from
the environment automatically.

> **Registry caveat.** pi-ai ships a **static** model registry. `getModel()`
> returns `undefined` for any id not in it and genie then fails to start, so a
> model newer than the pinned pi-ai is not selectable until pi-ai is bumped.
> (`nvidia/nemotron-3-ultra-550b-a55b:free` — the `nemotron` alias — is in
> pi-ai ≥ 0.79's registry; it was absent in 0.78.) The image runs a **model
> preflight** before any live call: a bad pick fails fast and prints the valid
> free models instead of an opaque agent crash.

**Rate limits.** The `429` on `:free` models is upstream OpenRouter throttling,
not an image/genie fault. Either retry shortly, switch model (`--model
<alias>`), or add a little credit to your OpenRouter account — even a small
balance raises the free-tier rate limits substantially.

### Interactive mode — talk to genie yourself

The `interactive` mode (aliases: `chat`, `repl`) drops you into a **live
conversational REPL** with the agent. It boots `packages/genie/dev-repl.js`,
which wires the genie agent to a **real** model (it registers the built-in
pi-ai providers and resolves the `-m provider/modelId` string exactly the way
the daemon resolves `GENIE_MODEL`), then presents a `you>` prompt. Type a
message, press Enter, and the agent's reply streams back live with tool-call and
thinking visualisation. `.help` lists dot-commands; `.exit` (or Ctrl-C) quits.

```sh
docker run --rm -it \
  --privileged \
  --env-file ~/secrets/openrouter.env \
  genie interactive
```

(Use the lighter `--security-opt seccomp=unconfined --security-opt
apparmor=unconfined` pair instead of `--privileged` if your policy prefers it.)
**`-it` is required** so the REPL gets a TTY for readline.

Notes:

- This path does **not** use `integration.sh`'s `trace_reply` — the dev-repl
  owns its own readline loop and prints replies directly, so you always see
  answers regardless of the harness's inbox parsing.
- The model defaults to `GENIE_MODEL` (the free OpenRouter qwen model); override
  with `--model <alias|spec>` or `-e GENIE_MODEL=openrouter/<vendor>/<model>`.
- The workspace defaults to a fresh dir under `packages/genie/tmp/`; dev-repl
  auto-seeds the genie workspace template into it on first use. Override with
  `-e GENIE_WORKSPACE=/some/dir`.
- The sandbox slice backend defaults to `auto`: it probes for bubblewrap/podman
  and, if neither is available, prints a yellow warning and falls back to **host
  spawn** (tool commands run un-sandboxed) so the chat still works on a host
  without user namespaces. Demand a confined slice with `-e GENIE_SANDBOX=bwrap`
  (errors out if userns is unavailable), or skip slice minting entirely with
  `-e GENIE_SANDBOX=off`. The slice network profile defaults to `private`;
  override with `-e GENIE_NETWORK=<none|private|host-loopback|host-lan|host-net>`.

Things to try at the `you>` prompt once the agent is ready:

```
read the file test-artifact.txt and tell me what it says
run the bash command `pwd` and show me the output
run `mount` and show me the workspace bind
```

(Drop a file into the workspace dir on the host first — e.g. bind-mount a dir as
`GENIE_WORKSPACE` — if you want the agent to read your own content.)

---

## 4. Known infra fix — `trace_reply` reply detection (pre-existing, patched in-image)

The integration scenarios drive the agent through
`packages/genie/test/integration.sh`, whose `trace_reply` helper polls the host
inbox for the agent's reply. On `llm` (and the #422 branch) that helper has
**two pre-existing bugs** — upstream test-harness infrastructure faults, not
introduced by any particular branch:

1. **Literal-glob classifiers.** The skip-classifier patterns were written
   double-quoted (e.g. `[[ "$line" == "[0-9]*. sent *" ]]`). Quoting the
   right-hand side makes bash match the pattern **literally**, so the skip-sent
   / skip-requested / skip-proposed / skip-thinking branches never fired, and
   every inbox line — including our own echoed prompt — fell through to the "Got
   reply" branch.
2. **Subshell `return`.** The inbox scan was a pipeline
   (`endo inbox | grep … | while read … done`). A piped `while` runs in a
   **subshell**, so its `return 0` exited only the subshell; `trace_reply` could
   never return early and always spun to its 180s deadline — a guaranteed
   timeout regardless of whether the agent actually replied.

`harness-fixes.patch` fixes both:

- The classifiers are unquoted (real globs) and rewritten to discriminate
  **structurally**: an `endo inbox` line for a message we sent is *verb-first*
  (`N. sent "agent" "…"`), while the agent's substantive reply is
  *sender-name-first* (`N. "agent" sent "…"` / `N. "agent" replied to "…"`).
  Tool calls (`requested`) and proposals (`proposed`) are skipped; `Thinking…`
  status lines are skipped before the reply branch.
- The pipeline is replaced with process substitution
  (`while … done < <(endo inbox | grep …)`) so the loop runs in the current
  shell and `return 0` returns from `trace_reply`.
- On timeout (`return 1`) the helper now dumps `endo log | tail` plus each
  worker log to stderr (mirroring the Phase-3 readiness dump) so a model-side
  error (bad/expired key, a free model that won't emit tool calls, blocked
  egress to `openrouter.ai`) is visible instead of a silent spin.

The fix is applied to the **in-image clone at build time** (`git apply` right
after the `git clone`); the build fails loudly if the patch does not apply
cleanly. The upstream tree is otherwise untouched. The patch applies cleanly to
both `llm` and the `genie-earendil-pi-migration` branch.

---

## 5. Note — does the LLM call survive the sandbox?

A natural concern: the genie agent's tool calls run inside a `bwrap` slice whose
default network profile is `private` (a loopback-only network namespace with an
egress nft filter). If the **LLM HTTP call** went out through that slice, the
OpenRouter request would be blocked.

Reading the code, the LLM call does **not** run inside the slice. The
`pi-agent-core` agent (which makes the OpenRouter HTTPS request) runs in the
**daemon worker process** on the container's host network; the slice only wraps
the agent's `bash` / `exec` / `git` *tool* spawner. So the OpenRouter call uses
the container's normal egress and is unaffected by the slice's `private`
profile. (The `sandbox-slice` scenario's probe D deliberately relies on the
slice's loopback being unreachable — that is the slice working as intended, not
the LLM being blocked.)

What this means in practice:

- The container must have **outbound HTTPS to `openrouter.ai`** (normal Docker
  bridge networking provides this; an air-gapped or egress-filtered host will
  fail the live modes).
- If a live mode hangs and then prints the timeout banner ("agent did not
  announce readiness within 120s") followed by worker logs, look for a
  fetch/connect/timeout error against `openrouter.ai`. That is an egress problem
  (host firewall, proxy, missing CA), **not** a slice problem.
- A bad/expired key surfaces the same way (the agent never announces "ready").
  Re-check `~/secrets/openrouter.env` and the key's credit cap.
- Fallbacks if egress to OpenRouter is unavailable: run `dev-repl-sandbox` (no
  network LLM at all), or point `GENIE_MODEL` at a model reachable from inside
  the container (e.g. an `ollama/<model>` against an Ollama you expose).

---

## Files

- `Dockerfile` — node:22-bookworm + git/bwrap/passt/nftables/native-build deps;
  clones the chosen `REPO_REF`, applies `harness-fixes.patch` to the in-image
  clone, installs and builds the workspace, defaults `GENIE_MODEL` to the free
  OpenRouter qwen model. No key, no tests at build.
- `entrypoint.sh` — preflights bwrap + userns, validates the key and the model
  for the live modes, runs the scenarios with a pass/fail summary, offers an
  `interactive` REPL (talk to genie yourself) and a `shell` debug mode. Model
  selectable via `--model`.
- `harness-fixes.patch` — unified diff that fixes the pre-existing `trace_reply`
  reply-detection bugs in `packages/genie/test/integration.sh`; applied in-image
  at build time. See § "Known infra fix".
- `README.md` — this file.
