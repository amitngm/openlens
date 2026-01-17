{{/*
Expand the name of the chart.
*/}}
{{- define "qa-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "qa-agent.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "qa-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "qa-agent.labels" -}}
helm.sh/chart: {{ include "qa-agent.chart" . }}
{{ include "qa-agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "qa-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "qa-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Agent API selector labels
*/}}
{{- define "qa-agent.api.selectorLabels" -}}
{{ include "qa-agent.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Runner selector labels
*/}}
{{- define "qa-agent.runner.selectorLabels" -}}
{{ include "qa-agent.selectorLabels" . }}
app.kubernetes.io/component: runner
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "qa-agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "qa-agent.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the secret to use
*/}}
{{- define "qa-agent.secretName" -}}
{{- if .Values.secrets.create }}
{{- default (printf "%s-secrets" (include "qa-agent.fullname" .)) .Values.secrets.name }}
{{- else }}
{{- .Values.secrets.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the PVC
*/}}
{{- define "qa-agent.pvcName" -}}
{{- printf "%s-artifacts" (include "qa-agent.fullname" .) }}
{{- end }}

{{/*
Create the name of the ConfigMap
*/}}
{{- define "qa-agent.configMapName" -}}
{{- printf "%s-config" (include "qa-agent.fullname" .) }}
{{- end }}
