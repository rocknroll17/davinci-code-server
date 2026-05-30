#!/usr/bin/env bash
# Publish a trained model to GHCR as the source-of-truth OCI artifact.
#
# The model is versioned independently of the code (it changes when you retrain).
# The release workflow (.github/workflows/release.yml) pulls this artifact and
# bakes it into the server image, so deploy needs no mount and no model download.
#
# Prereqs:
#   - oras CLI            https://oras.land/docs/installation
#   - logged in to GHCR:  echo $GHCR_TOKEN | oras login ghcr.io -u <user> --password-stdin
#                         (token needs write:packages)
#
# Usage:
#   scripts/publish_model.sh <path-to-model.pt> <version>
#   e.g. scripts/publish_model.sh checkpoints/model.pt 0.3.0
#
# Pushes ghcr.io/<OWNER>/davinci-model:<version> and :latest.
set -euo pipefail

MODEL="${1:-checkpoints/model.pt}"
VERSION="${2:?usage: publish_model.sh <path-to-model.pt> <version>}"
OWNER="${OWNER:-rocknroll17}"
IMAGE="ghcr.io/${OWNER}/davinci-model"

[ -f "$MODEL" ] || { echo "model not found: $MODEL" >&2; exit 1; }

dir="$(cd "$(dirname "$MODEL")" && pwd)"
file="$(basename "$MODEL")"

( cd "$dir" && oras push \
    "${IMAGE}:${VERSION},latest" \
    --artifact-type application/vnd.davinci.model.v1 \
    "${file}:application/octet-stream" )

echo "published ${IMAGE}:${VERSION} (+ latest)"
echo "the next release build will bake whatever MODEL_TAG points to (default: latest)"
