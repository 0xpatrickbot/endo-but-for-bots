#!/usr/bin/env bash
# Entrypoint for the @endo/genie Docker image.
#
# Usage (passed as the `docker run` CMD / args):
#   <mode> [--model <spec>]
#
# Modes:
#   all                      run all three integration scripts in sequence (default)
#   integration              run only the workspace-tool scenario (live LLM)
#   sandbox-slice            run only the sandbox-slice scenario (live LLM)
#   dev-repl-sandbox         run only the faux-LLM dev-repl scenario (no key)
#   interactive              live REPL — YOU chat with genie from the CLI
#   shell                    drop into an interactive bash shell for debugging
#
# Model selection (--model / -m, or the GENIE_MODEL env var):
#   --model qwen/qwen3-coder:free          # bare OpenRouter id → openrouter/ prefix added
#   --model openrouter/qwen/qwen3-coder    # explicit provider kept as-is
#   --model ollama/llama3.2                # explicit provider kept as-is
#   --model gptoss                         # short alias (see ALIASES below)
# Aliases (handy for hopping off a rate-limited free model):
#   qwen     → openrouter/qwen/qwen3-coder:free
#   llama    → openrouter/meta-llama/llama-3.3-70b-instruct:free
#   gptoss   → openrouter/openai/gpt-oss-120b:free
#   deepseek → openrouter/deepseek/deepseek-v4-flash:free
#   glm      → openrouter/z-ai/glm-4.5-air:free
#   nemotron → openrouter/nvidia/nemotron-3-super-120b-a12b:free
# The default is GENIE_MODEL from the image (openrouter/qwen/qwen3-coder:free).
#
# NOTE: pi-ai (the version #422 pins, currently ^0.79.0) ships a STATIC model
# registry; getModel() returns undefined for any id not in it, and genie then
# fails to start. So only models in that build's registry resolve — a model
# newer than the pinned pi-ai is NOT selectable until pi-ai is bumped. The
# `validate_model` preflight below catches a bad pick and prints the valid set.
#
# The two live scenarios and `interactive` make a live LLM call and REQUIRE
# OPENROUTER_API_KEY. `dev-repl-sandbox` uses a faux scripted LLM and needs NO
# key — only bwrap and unprivileged user namespaces.

set -uo pipefail

GENIE_DIR="/opt/endo/packages/genie"
cd "$GENIE_DIR"

# ---------------------------------------------------------------------------
# Model alias / shorthand resolution.
#   - named aliases expand to a full openrouter spec
#   - an explicit provider prefix (openrouter/ or ollama/) is kept verbatim
#   - anything else is treated as a bare OpenRouter model id and gets the
#     `openrouter/` prefix (so `openai/gpt-oss-120b:free` — an OpenRouter
#     *vendor*, not the openai provider — becomes openrouter/openai/...).
# ---------------------------------------------------------------------------
resolve_model_alias() {
  case "$1" in
    qwen)     echo "openrouter/qwen/qwen3-coder:free" ;;
    llama)    echo "openrouter/meta-llama/llama-3.3-70b-instruct:free" ;;
    gptoss)   echo "openrouter/openai/gpt-oss-120b:free" ;;
    deepseek) echo "openrouter/deepseek/deepseek-v4-flash:free" ;;
    glm)      echo "openrouter/z-ai/glm-4.5-air:free" ;;
    nemotron) echo "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free" ;;
    openrouter/*|ollama/*) echo "$1" ;;
    *)        echo "openrouter/$1" ;;
  esac
}

# ---------------------------------------------------------------------------
# Argument parsing: one positional <mode>, plus --model/-m anywhere.
# ---------------------------------------------------------------------------
MODE=""
MODEL_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model)
      [[ $# -ge 2 ]] || { echo "[harness] ERROR: $1 needs a value." >&2; exit 2; }
      MODEL_FLAG="$2"; shift 2 ;;
    --model=*) MODEL_FLAG="${1#--model=}"; shift ;;
    --) shift ;;
    -*) echo "[harness] ERROR: unknown flag: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$MODE" ]]; then MODE="$1"; shift
      else echo "[harness] ERROR: unexpected argument: $1" >&2; exit 2; fi ;;
  esac
done
MODE="${MODE:-all}"

# The flag wins over the image's GENIE_MODEL env default; both feed one MODEL.
if [[ -n "$MODEL_FLAG" ]]; then
  GENIE_MODEL="$(resolve_model_alias "$MODEL_FLAG")"
  export GENIE_MODEL
fi
MODEL="${GENIE_MODEL:-openrouter/qwen/qwen3-coder:free}"

# ---------------------------------------------------------------------------
# Preflight: bubblewrap + unprivileged user namespaces.
# All scenarios mint a bwrap slice; surface a clear diagnosis up front rather
# than letting the agent time out 120s later.
# ---------------------------------------------------------------------------
preflight_sandbox() {
  if ! bwrap --version >/dev/null 2>&1; then
    echo "[harness] ERROR: bwrap (bubblewrap) is not available." >&2
    echo "[harness] The image installs it; if this fails the build is broken." >&2
    return 1
  fi
  if ! bwrap --unshare-all --die-with-parent \
          --ro-bind-try /usr /usr --ro-bind-try /lib /lib \
          --ro-bind-try /lib64 /lib64 --ro-bind-try /bin /bin \
          --proc /proc --dev /dev --clearenv -- /bin/true >/dev/null 2>&1; then
    echo "[harness] ERROR: unprivileged user-namespace smoke test failed." >&2
    echo "[harness] The container cannot create a user namespace. Re-run the" >&2
    echo "[harness] container with --privileged (or the lighter seccomp/apparmor" >&2
    echo "[harness] unconfined flags), and confirm the HOST kernel permits" >&2
    echo "[harness] unprivileged userns (sysctl kernel.unprivileged_userns_clone=1)." >&2
    return 1
  fi
  echo "[harness] Preflight OK: bwrap present and unprivileged userns works."
  return 0
}

# ---------------------------------------------------------------------------
# Key check (only for the live-LLM scenarios + interactive).
# ---------------------------------------------------------------------------
require_key() {
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "[harness] ERROR: OPENROUTER_API_KEY is not set." >&2
    echo "[harness] Inject it at run time, e.g.:" >&2
    echo "[harness]   docker run --env-file ~/secrets/openrouter.env ..." >&2
    echo "[harness] Never bake the key into the image or paste it in chat." >&2
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Model preflight: the pinned pi-ai's openrouter registry is static, and genie's
# getModel() returns undefined for an unregistered id (→ the agent fails to
# start with an opaque error). Catch a bad pick here and print the valid free
# models instead. Best-effort: if the registry can't be queried, it skips.
# Only openrouter/* specs are gated; ollama models are constructed, not looked
# up in the registry.
# ---------------------------------------------------------------------------
validate_model() {
  case "$MODEL" in openrouter/*) ;; *) return 0 ;; esac
  local id="${MODEL#openrouter/}" out
  if ! out="$(MODEL_ID="$id" yarn node --input-type=module -e '
import { getModel, getModels, registerBuiltInApiProviders } from "@earendil-works/pi-ai";
registerBuiltInApiProviders();
if (getModel("openrouter", process.env.MODEL_ID)) { console.log("OK"); }
else {
  console.log("MISS");
  const free = getModels("openrouter")
    .map(m => m && m.id)
    .filter(s => typeof s === "string" && s.endsWith(":free"))
    .sort();
  console.error(free.join("\n"));
}
' 2>/tmp/free_models.txt)"; then
    echo "[harness] (model preflight skipped: could not query pi-ai registry)" >&2
    return 0
  fi
  if [[ "$out" == OK* ]]; then return 0; fi
  echo "[harness] ERROR: '$MODEL' is not in this build's pi-ai registry." >&2
  echo "[harness] genie's getModel() returns undefined for it, so the agent will" >&2
  echo "[harness] fail to start. Pick a model that resolves — free OpenRouter" >&2
  echo "[harness] models in this build (pass the part after 'openrouter/'):" >&2
  sed 's#^#[harness]   openrouter/#' /tmp/free_models.txt >&2
  return 1
}

PASS=()
FAIL=()

# Run a faux/no-model yarn script (dev-repl-sandbox), recording pass/fail.
run_yarn() {
  local label="$1" script="$2"
  echo ""
  echo "==================================================================="
  echo "[harness] >>> $label  (yarn $script)"
  echo "==================================================================="
  if yarn "$script"; then
    echo "[harness] <<< PASS: $label"; PASS+=("$label")
  else
    local rc=$?; echo "[harness] <<< FAIL ($rc): $label" >&2; FAIL+=("$label")
  fi
}

# Run a live-LLM scenario directly through integration.sh with the CHOSEN
# model. NOTE: the package.json `yarn test:integration*` scripts hardcode
# `-E GENIE_MODEL=ollama/llama3.2`, so we bypass them and pass $MODEL instead;
# that is the whole point of being able to pick an OpenRouter model here.
run_scenario() {
  local label="$1" scenario="$2"
  echo ""
  echo "==================================================================="
  echo "[harness] >>> $label"
  echo "[harness]     model:    $MODEL"
  echo "[harness]     scenario: $scenario"
  echo "==================================================================="
  if bash test/integration.sh -E GENIE_MODEL="$MODEL" -E GENIE_TEST="$scenario"; then
    echo "[harness] <<< PASS: $label"; PASS+=("$label")
  else
    local rc=$?; echo "[harness] <<< FAIL ($rc): $label" >&2; FAIL+=("$label")
  fi
}

summary() {
  echo ""
  echo "==================================================================="
  echo "[harness] SUMMARY  (model: $MODEL)"
  for p in "${PASS[@]:-}"; do [[ -n "$p" ]] && echo "  PASS  $p"; done
  for f in "${FAIL[@]:-}"; do [[ -n "$f" ]] && echo "  FAIL  $f"; done
  echo "==================================================================="
  [[ ${#FAIL[@]} -eq 0 ]]
}

case "$MODE" in
  shell)
    echo "[harness] Dropping into interactive shell in $GENIE_DIR."
    echo "[harness] Run scenarios manually, e.g. 'yarn test:integration:dev-repl-sandbox'."
    echo "[harness] Chosen model (GENIE_MODEL): $MODEL"
    exec bash
    ;;

  interactive|chat|repl)
    # Live conversational REPL: the operator talks to genie directly.
    #
    # This boots `dev-repl.js`, which wires the @endo/genie agent to a
    # REAL model (it calls registerBuiltInApiProviders() and resolves the
    # `-m provider/modelId` string exactly like the daemon's GENIE_MODEL),
    # then drops into a readline loop with a `you>` prompt.  Type a
    # message, press Enter, and the agent's reply streams back live with
    # tool-call / thinking visualisation.  Type `.exit` (or Ctrl-C) to
    # quit, `.help` for dot-commands.
    #
    # This path does NOT use integration.sh's trace_reply at all — the
    # dev-repl owns its own interactive loop and prints replies directly,
    # so the human always sees answers regardless of the harness's inbox
    # parsing.  It needs the live key and (for a confined slice) bwrap +
    # userns; with `--sandbox auto` it falls back to host spawn (with a
    # yellow warning) when no backend is available, so the chat still
    # works on a host without userns — only the slice confinement is
    # dropped in that case.
    preflight_sandbox || {
      echo "[harness] NOTE: sandbox preflight failed; dev-repl --sandbox auto" >&2
      echo "[harness] will fall back to HOST spawn (tools run un-sandboxed)." >&2
    }
    require_key || exit 1
    validate_model || exit 1

    # dev-repl's -w must point at a directory; it auto-seeds the genie
    # workspace template on first use, so a fresh empty dir is fine.
    WORKSPACE_DIR="${GENIE_WORKSPACE:-/opt/endo/packages/genie/tmp/interactive-workspace}"
    mkdir -p "$WORKSPACE_DIR"

    # Slice backend: `auto` probes for bwrap/podman and warns+falls back
    # to host spawn if neither is available.  Override with
    # GENIE_SANDBOX=bwrap to demand a confined slice (errors if userns is
    # unavailable), or GENIE_SANDBOX=off to skip slice minting entirely.
    SANDBOX="${GENIE_SANDBOX:-auto}"
    NETWORK="${GENIE_NETWORK:-private}"

    echo ""
    echo "==================================================================="
    echo "[harness] Interactive genie REPL"
    echo "[harness]   model:     $MODEL"
    echo "[harness]   workspace: $WORKSPACE_DIR"
    echo "[harness]   sandbox:   $SANDBOX (network: $NETWORK)"
    echo "[harness] -------------------------------------------------------------------"
    echo "[harness] At the 'you>' prompt, type a message and press Enter."
    echo "[harness] The agent's reply streams back below it."
    echo "[harness] Try:  read the file <name>   |   run the bash command \`pwd\`"
    echo "[harness] Dot-commands: .help  .tools  .clear  .exit"
    echo "[harness] Quit with .exit or Ctrl-C."
    echo "[harness] Rate-limited? Re-run with e.g.  interactive --model gptoss"
    echo "==================================================================="
    echo ""

    # Ensure the faux-script seam is OFF so a LIVE model is used.
    unset GENIE_FAUX_SCRIPT
    exec node dev-repl.js \
      -w "$WORKSPACE_DIR" \
      -m "$MODEL" \
      --sandbox "$SANDBOX" \
      --network "$NETWORK"
    ;;

  dev-repl-sandbox)
    # Faux LLM — no key needed, only the sandbox.
    preflight_sandbox || exit 1
    run_yarn "dev-repl-sandbox (faux LLM)" "test:integration:dev-repl-sandbox"
    summary
    ;;

  integration)
    preflight_sandbox || exit 1
    require_key || exit 1
    validate_model || exit 1
    run_scenario "workspace-tool (live LLM)" "test/scenarios/workspace-tool.sh"
    summary
    ;;

  sandbox-slice)
    preflight_sandbox || exit 1
    require_key || exit 1
    validate_model || exit 1
    run_scenario "sandbox-slice (live LLM)" "test/scenarios/sandbox-slice.sh"
    summary
    ;;

  all)
    preflight_sandbox || exit 1
    # The faux dev-repl scenario runs even without a key; the two live-LLM
    # scenarios are skipped with a loud notice if the key is absent.
    run_yarn "dev-repl-sandbox (faux LLM)" "test:integration:dev-repl-sandbox"
    if require_key && validate_model; then
      run_scenario "workspace-tool (live LLM)" "test/scenarios/workspace-tool.sh"
      run_scenario "sandbox-slice (live LLM)" "test/scenarios/sandbox-slice.sh"
    else
      echo "[harness] Skipping the two live-LLM scenarios (missing key or invalid model; see above)."
      FAIL+=("workspace-tool (skipped: no key / bad model)")
      FAIL+=("sandbox-slice (skipped: no key / bad model)")
    fi
    summary
    ;;

  *)
    echo "[harness] Unknown mode: $MODE" >&2
    echo "[harness] Use one of: all | integration | sandbox-slice | dev-repl-sandbox | interactive | shell" >&2
    echo "[harness] Optionally add: --model <spec|alias>  (e.g. --model gptoss)" >&2
    exit 2
    ;;
esac
