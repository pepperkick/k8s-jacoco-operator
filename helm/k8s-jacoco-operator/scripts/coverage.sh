#!/usr/bin/env sh

# This script is expected to run inside the jacoco-operator-file-access pod
# This is expected to be namespace scoped to where jacoco-operator is deployed

# Requirements
# - java
# - kubectl
# - jq

# List all pods which are instrumented
POD_NAMES=$(kubectl get pods -o json | jq -r '.items[] | select(.metadata.annotations["jacoco-operator.curium.rocks/inject"] == "true") | "\(.metadata.name)"')
if [ -z "$POD_NAMES" ]; then
  echo "No pods found with the annotation jacoco-operator.curium.rocks/inject=true"
  exit 0
fi

rm /tmp/*.exec || true

# Loop through each pod
echo "Processing pods with annotation jacoco-operator.curium.rocks/inject=true:"
for pod in $POD_NAMES; do
  name=$(echo $pod | cut -d'/' -f1)

  echo "Fetching jacoco exec file from pod $name..."

  kubectl exec $pod -- bash -c "rm /tmp/report.exec || true; JAVA_TOOL_OPTIONS='' java -jar /mnt/jacoco/agent/jacoco-cli/jacoco-cli.jar dump --destfile /tmp/report.exec"
  kubectl exec $pod -- bash -c "cat /tmp/report.exec | base64 -w 0" > /tmp/$pod.exec.b64

  cat /tmp/$pod.exec.b64 | base64 -d > /tmp/$pod.exec
  rm /tmp/$pod.exec.b64
done

echo "Merge all collected reports based on pod generated name"
FINAL_REPORTS=""
for pod in $POD_NAMES; do
  nameTemplate=$(kubectl get pod $pod -o json | jq ".metadata.generateName" -r)
  finalName=$nameTemplate

  if [[ "$finalName" == "*-" ]]; then
    finalName=${finalName%?}
  fi

  if echo "$FINAL_REPORTS" | grep "$finalName"; then
    continue
  fi

  java -jar /mnt/jacoco/agents/jacoco-cli/jacoco-cli.jar merge /tmp/$nameTemplate*.exec --destfile /tmp/$finalName.exec
  FINAL_REPORTS="$FINAL_REPORTS $finalName"
done

echo "Final Reports: $FINAL_REPORTS"