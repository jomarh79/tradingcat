# Prueba manual de POST /api/oficina/prueba-fundamental (solo ASCII). SOLO analiza: no guarda nada ni opera. Cuesta llamadas a OpenAI.
# Trae el estado de resultados de tu propia ruta /api/webull/income-statement (o de un archivo con -IncomeStatementPath) y lo manda a la prueba.
# Pide tu correo y tu clave (no se muestran ni se guardan) o, con -ConToken, tu access_token. No imprime tokens ni claves.
param(
  [string]$Ticker = "GKOS",
  [string]$Base = "http://localhost:3000",
  [string]$IncomeStatementPath = "",
  [string]$ItemsExtraPath = "",
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

# 2) Estado de resultados (texto JSON tal cual, sin reserializar; la ruta de tu app tambien exige el token)
if ($IncomeStatementPath -ne "") {
  $incomeRaw = Get-Content -Raw -Encoding UTF8 $IncomeStatementPath
} else {
  try {
    $r0 = Invoke-WebRequest -Method Get -Uri ($Base + "/api/webull/income-statement?symbol=" + [uri]::EscapeDataString($tk)) -Headers @{ Authorization = ("Bearer " + $token) } -UseBasicParsing
    $incomeRaw = $r0.Content
  } catch {
    Write-Host "No pude traer income-statement de tu app (si Webull pide 2FA o falla, guarda el JSON en un archivo y usa -IncomeStatementPath):"
    Write-Host (Read-ErrorBody $_)
    exit 1
  }
}
if ([string]::IsNullOrWhiteSpace($incomeRaw)) { Write-Host "income-statement vacio."; exit 1 }
$extraRaw = "[]"
if ($ItemsExtraPath -ne "") { $extraRaw = Get-Content -Raw -Encoding UTF8 $ItemsExtraPath }
$conDir = "true"
if ($SinDirector) { $conDir = "false" }
$body = '{"ticker":"' + $tk + '","portafolio":"' + $Portafolio + '","con_director":' + $conDir + ',"items_extra":' + $extraRaw + ',"income_statement":' + $incomeRaw + '}'

# 3) Llamada (puede tardar un minuto o mas: dos llamadas a OpenAI)
try {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $r = Invoke-WebRequest -Method Post -Uri ($Base + "/api/oficina/prueba-fundamental") -Headers @{ Authorization = ("Bearer " + $token) } -ContentType "application/json; charset=utf-8" -Body $bytes -UseBasicParsing -TimeoutSec 600
  Write-Host "HTTP" $r.StatusCode
  $r.Content | ConvertFrom-Json | ConvertTo-Json -Depth 20
} catch {
  Write-Host "La ruta respondio con error:"
  Write-Host (Read-ErrorBody $_)
}
$token = $null
