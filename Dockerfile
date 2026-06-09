# syntax=docker/dockerfile:1
#
# Docker image for @endo/genie (endojs/endo-but-for-bots).
#
# Runs @endo/genie in a container — its integration scenarios and an
# interactive REPL — against a live OpenRouter model, on a userns-capable
# Docker host. Build any branch/PR via the REPO_REF build-arg (defaults to
# the `llm` mainline; set REPO_REF=genie-earendil-pi-migration to exercise
# PR #422's pi→earendil migration).
#
# Builds an image that can run the three genie integration scripts:
#   - yarn test:integration                  (live LLM round-trip; needs OPENROUTER_API_KEY)
#   - yarn test:integration:sandbox-slice     (live LLM round-trip; needs OPENROUTER_API_KEY)
#   - yarn test:integration:dev-repl-sandbox  (faux scripted LLM; needs NO key)
#
# All three need bubblewrap + unprivileged user namespaces, which is why the
# image is meant to run on a privileged-capable Docker HOST (see README.md for
# the docker run flags). The tests are NOT run at build time — no API key is
# available during build, and the build stays key-free on purpose.

FROM node:22-bookworm

# ---------------------------------------------------------------------------
# OS packages
#   git, ca-certificates  — clone the repo, TLS for the OpenRouter call
#   bubblewrap            — the genie sandbox slice driver (bwrap)
#   passt                 — provides `pasta`, used by the slice's default
#                           `network: 'private'` profile for egress NAT
#   nftables              — provides `nft`, loads the slice's private-egress
#                           ruleset inside the netns
#   python3 make g++      — native toolchain for the better-sqlite3 build
#                           (lavamoat allow-scripts runs its install script)
#   procps                — `pkill` used by integration.sh cleanup; `ps`
#   curl                  — present in the rootfs so sandbox-slice probe D
#                           can exercise the loopback-unreachable check
# ---------------------------------------------------------------------------
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      bubblewrap \
      passt \
      nftables \
      python3 \
      make \
      g++ \
      procps \
      curl \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Yarn 4 via corepack (the repo pins packageManager: yarn@4.13.0).
# ---------------------------------------------------------------------------
RUN corepack enable

# ---------------------------------------------------------------------------
# Clone the endo monorepo at the chosen ref.
#   REPO_URL  — overridable if you want your own fork.
#   REPO_REF  — branch/tag/PR ref to build. Defaults to the `llm` mainline;
#               set to genie-earendil-pi-migration to exercise PR #422.
# A shallow single-branch clone keeps the image small; the build only needs
# the tree at the ref tip, not history.
# ---------------------------------------------------------------------------
ARG REPO_URL=https://github.com/endojs/endo-but-for-bots.git
ARG REPO_REF=llm

WORKDIR /opt
RUN git clone --depth 1 --branch "${REPO_REF}" --single-branch "${REPO_URL}" endo

WORKDIR /opt/endo

# ---------------------------------------------------------------------------
# Harness fix patch (applied to the in-image clone before install/build).
#
# `packages/genie/test/integration.sh`'s reply-detection helper
# (`trace_reply`) has two PRE-EXISTING bugs in the upstream branch — they
# are infrastructure faults in the test harness, NOT introduced by the
# #422 migration:
#   1. The skip-classifier patterns were DOUBLE-QUOTED globs, so bash
#      matched them literally and none of the skip branches ever fired —
#      every inbox line (including our own echoed prompt) fell through to
#      the "Got reply" branch.
#   2. The inbox scan ran as a `... | while read` PIPELINE, so its
#      `return 0` exited only the subshell; `trace_reply` could never
#      return early and always spun to its deadline (guaranteed timeout).
# harness-fixes.patch corrects the classifiers (structural sender-name
# discrimination), switches the loop to process substitution so `return`
# returns from the function, and dumps daemon + worker logs on timeout so
# a model-side error is visible.  See README.md § "Known infra fix".
#
# `git apply` is used (not `patch`) so the diff is validated against the
# exact branch tree; the build fails loudly if the patch does not apply
# cleanly (e.g. the branch moved out from under the patch).
COPY harness-fixes.patch /opt/harness-fixes.patch
RUN git apply --verbose /opt/harness-fixes.patch \
 && echo "[build] harness-fixes.patch applied cleanly."

# ---------------------------------------------------------------------------
# Install + build the workspace.
#
# `yarn install` resolves the whole monorepo (including @earendil-works/pi-ai
# and @earendil-works/pi-agent-core at ^0.79.0) and runs the allow-scripted
# better-sqlite3 native build.
#
# `yarn build` runs each package's build script so the @endo/* workspace deps
# the genie + cli packages import at runtime are present. (genie's own build
# is a no-op, but its workspace deps — daemon, cli, sandbox, marshal, … — are
# not.) If a full `yarn build` is too heavy for your host you can narrow it,
# but the default builds everything so the endo CLI + daemon boot cleanly.
# ---------------------------------------------------------------------------
RUN yarn install
RUN yarn build

# ---------------------------------------------------------------------------
# Default model. resolveModel() in packages/genie/src/agent/index.js splits
# GENIE_MODEL on the FIRST "/" into provider + modelId, so:
#   provider = openrouter
#   modelId  = qwen/qwen3-coder:free
# `openrouter` is a built-in pi-ai provider and reads OPENROUTER_API_KEY from
# the environment automatically. Override at run time with `-e GENIE_MODEL=...`.
# ---------------------------------------------------------------------------
ENV GENIE_MODEL=openrouter/qwen/qwen3-coder:free

# The OPENROUTER_API_KEY is intentionally NOT set here. It is injected only at
# `docker run` time via --env-file. Never bake a key into the image.

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /opt/endo/packages/genie
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["all"]
