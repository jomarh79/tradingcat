# Prueba manual de POST /api/oficina/analisis-fundamental (solo ASCII). El SERVIDOR trae los datos (Webull y Finnhub): no hay que pegar JSON.
# SOLO analiza: no guarda nada ni opera. Cuesta llamadas al proveedor de IA. No imprime tokens ni claves.
# Pide tu access_token (con -ConToken) o tu correo y clave de Supabase (no se muestran ni se guardan).
# Importante: el servidor necesita llegar a Webull; si en local da timeout, usa -Base con la URL de tu app desplegada.
param(
  [string]$Ticker = "GKOS",
  [string]$Base = "http://localhost:3000",
  [string]$Portafolio = "PMP",
  [switch]$SinDirector,
  [switch]$ConToken
)
$ErrorActionPreference = "Stop"
$proj = "C:\Users\dell\trading-journal"
$envFile = Join-Path $proj ".env.local"

function Get-EnvValue([string]$name) {
  if (-not (Test-Path $envFile)) { throw "No existe .env.local en $proj" }
  $line = Get-Content $envFile | Where-Object { $_ -match ("^" + $name + "\s*=") } | Select-Object -First 1
  if (-not $line) { throw "Falta $name en .env.local" }
  return ($line -replace ("^" + $name + "\s*=\s*"), "").Trim().Trim('"').Trim("'")
}
function Get-Utf8Text($resp) {
  return [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
}
function ConvertTo-Plain([System.Security.SecureString]$s) {
  $cred = New-Object System.Net.NetworkCredential("", $s)
  return $cred.Password
}
function Read-ErrorBody($err) {
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) { return $err.ErrorDetails.Message }
  try {
    $resp = $err.Exception.Response
    if ($null -eq $resp) { return $err.Exception.Message }
    $stream = $resp.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } catch { return $err.Exception.Message }
}

# 1) Token de sesion
$token = ""
if ($ConToken) {
  $token = ConvertTo-Plain (Read-Host "Pega tu access_token (no se muestra)" -AsSecureString)
} else {
  $url = Get-EnvValue "NEXT_PUBLIC_SUPABASE_URL"
  $anon = Get-EnvValue "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  $correo = Read-Host "Correo de tu cuenta de Supabase"
  $clave = ConvertTo-Plain (Read-Host "Clave (no se muestra)" -AsSecureString)
  $cuerpoLogin = @{ email = $correo; password = $clave } | ConvertTo-Json
  try {
    $login = Invoke-RestMethod -Method Post -Uri ($url + "/auth/v1/token?grant_type=password") -Headers @{ apikey = $anon } -ContentType "application/json" -Body $cuerpoLogin
  } catch {
    Write-Host "No se pudo iniciar sesion (revisa correo y clave, o usa -ConToken):" (Read-ErrorBody $_)
    exit 1
  }
  $token = $login.access_token
  $clave = $null; $cuerpoLogin = $null; $anon = $null
}
if ([string]::IsNullOrWhiteSpace($token)) { Write-Host "No hay token."; exit 1 }

$tk = $Ticker.Trim().ToUpper()
$conDir = "true"
if ($SinDirector) { $conDir = "false" }
$body = '{"ticker":"' + $tk + '","portafolio":"' + $Portafolio + '","con_director":' + $conDir + '}'

# 2) Llamada (puede tardar uno o dos minutos: datos de Webull y Finnhub y dos llamadas al modelo)
try {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $r = Invoke-WebRequest -Method Post -Uri ($Base + "/api/oficina/analisis-fundamental") -Headers @{ Authorization = ("Bearer " + $token) } -ContentType "application/json; charset=utf-8" -Body $bytes -UseBasicParsing -TimeoutSec 600
  Write-Host "HTTP" $r.StatusCode
  (Get-Utf8Text $r) | ConvertFrom-Json | ConvertTo-Json -Depth 20
} catch {
  Write-Host "La ruta respondio con error:"
  Write-Host (Read-ErrorBody $_)
}
$token = $null
