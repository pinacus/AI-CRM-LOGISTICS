$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$server = Join-Path $root "server"
$tsx = Join-Path $root "node_modules\tsx\dist\cli.mjs"
$argLine = '"' + $tsx + '" ' + '"src\index.ts"'
Start-Process -FilePath "node" -ArgumentList $argLine -WorkingDirectory $server -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root "api.log") -RedirectStandardError (Join-Path $root "api.err")
