#!/bin/sh
# Fetch the primary-source doc pages named in llms.txt into ./md/ — scratch dir only.
set -u
OUT="E:/music player/.scratch/jev-integration/_q2tmp/md"
mkdir -p "$OUT"
fetch() {
  name="$1"; url="$2"
  code=$(curl -sL -m 25 -o "$OUT/$name.md" -w "%{http_code}" "$url")
  bytes=$(wc -c < "$OUT/$name.md" | tr -d ' ')
  echo "$code  $bytes  $name  <- $url"
}
fetch introduction      https://docs.typesafe.ai/introduction.md
fetch quickstart        https://docs.typesafe.ai/introduction/quickstart.md
fetch system-one        https://docs.typesafe.ai/concepts/system-one.md
fetch state             https://docs.typesafe.ai/concepts/state.md
fetch primitives        https://docs.typesafe.ai/primitives.md
fetch choice            https://docs.typesafe.ai/primitives/choice.md
fetch score             https://docs.typesafe.ai/primitives/score.md
fetch noul              https://docs.typesafe.ai/primitives/noul.md
fetch advanced          https://docs.typesafe.ai/primitives/advanced.md
fetch ml-primer         https://docs.typesafe.ai/introduction/machine-learning-primer.md
fetch confidence        https://docs.typesafe.ai/confidence.md
fetch models            https://docs.typesafe.ai/models.md
fetch api-ref           https://docs.typesafe.ai/api.md
fetch sdk               https://docs.typesafe.ai/sdk.md
fetch sdk-python        https://docs.typesafe.ai/sdk/python.md
fetch sdk-js            https://docs.typesafe.ai/sdk/javascript.md
fetch agent-skill       https://docs.typesafe.ai/agent-skill.md
fetch legal             https://docs.typesafe.ai/legal.md
fetch jaggedness        https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
fetch howtobuild        https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md
fetch responses         https://docs.typesafe.ai/sdk/python/api/types/responses.md
fetch questions         https://docs.typesafe.ai/sdk/python/api/types/questions.md
fetch models-js         https://docs.typesafe.ai/sdk/javascript/api/interfaces/ModelCard.md
fetch parallel-ck       https://docs.typesafe.ai/cookbooks/parallel_questions.md
