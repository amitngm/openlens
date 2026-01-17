{{/*
Expand the name of the chart.
*/}}
{{- define "qa-agent-ui.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "qa-agent-ui.fullname" -}}
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
{{- define "qa-agent-ui.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "qa-agent-ui.labels" -}}
helm.sh/chart: {{ include "qa-agent-ui.chart" . }}
{{ include "qa-agent-ui.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "qa-agent-ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "qa-agent-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "qa-agent-ui.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "qa-agent-ui.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
QA Agent API URL
*/}}
{{- define "qa-agent-ui.apiUrl" -}}
{{- if .Values.qaAgentApi.url }}
{{- .Values.qaAgentApi.url }}
{{- else }}
{{- printf "http://%s:%d" .Values.qaAgentApi.serviceName (int .Values.qaAgentApi.port) }}
{{- end }}
{{- end }}
