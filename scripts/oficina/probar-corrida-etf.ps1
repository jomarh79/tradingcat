# Prueba manual de POST /api/oficina/corrida-etf (solo ASCII).
# Pide tu correo y tu clave (la clave no se muestra ni se guarda), obtiene un token de sesion y llama a la ruta local.
# No imprime ni guarda el token ni la clave anonima. Con -ConToken pegas tu access_token en lugar de usar correo y clave.
param(
  [string]$Ticker = "XLK",
  [string]$Base = "http://localhost:3000",
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
  try {
    $resp = $err.Exception.Response
    if ($null -eq $resp) { return $err.Exception.Message }
    $stream = $resp.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } catch { return $err.Exception.Message }
}

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

$cuerpo = @{ ticker = $Ticker } | ConvertTo-Json
try {
  $r = Invoke-WebRequest -Method Post -Uri ($Base + "/api/oficina/corrida-etf") -Headers @{ Authorization = ("Bearer " + $token) } -ContentType "application/json" -Body $cuerpo -UseBasicParsing
  Write-Host "HTTP" $r.StatusCode
  $r.Content | ConvertFrom-Json | ConvertTo-Json -Depth 12
} catch {
  Write-Host "La ruta respondio con error:"
  Write-Host (Read-ErrorBody $_)
}
$token = $null
