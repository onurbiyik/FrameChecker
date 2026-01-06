# Simple HTTP Server for Frame Checker
# This script starts a local web server on port 8000

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Frame Checker - Local Web Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if port 8000 is already in use
$port = 8000
$portInUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

if ($portInUse) {
    Write-Host "Warning: Port $port is already in use." -ForegroundColor Yellow
    Write-Host "Please close the application using port $port or choose a different port." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit
}

# Get the current directory
$currentPath = Get-Location

Write-Host "Starting web server..." -ForegroundColor Green
Write-Host "Directory: $currentPath" -ForegroundColor Gray
Write-Host "Port: $port" -ForegroundColor Gray
Write-Host ""
Write-Host "Open your browser and navigate to:" -ForegroundColor Green
Write-Host "  http://localhost:$port" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Start the HTTP listener
try {
    $http = [System.Net.HttpListener]::new()
    $http.Prefixes.Add("http://localhost:$port/")
    $http.Start()

    Write-Host "Server is running..." -ForegroundColor Green
    Write-Host ""

    while ($http.IsListening) {
        $context = $http.GetContext()
        $request = $context.Request
        $response = $context.Response

        # Get the requested file path
        $requestedPath = $request.Url.LocalPath
        if ($requestedPath -eq '/') {
            $requestedPath = '/index.html'
        }

        $filePath = Join-Path $currentPath $requestedPath.TrimStart('/')

        Write-Host "$(Get-Date -Format 'HH:mm:ss') - $($request.HttpMethod) $requestedPath" -ForegroundColor Gray

        if (Test-Path $filePath -PathType Leaf) {
            # File exists, serve it
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $content.Length
            
            # Set content type based on file extension
            $extension = [System.IO.Path]::GetExtension($filePath)
            $contentType = switch ($extension) {
                '.html' { 'text/html' }
                '.css'  { 'text/css' }
                '.js'   { 'application/javascript' }
                '.json' { 'application/json' }
                '.png'  { 'image/png' }
                '.jpg'  { 'image/jpeg' }
                '.jpeg' { 'image/jpeg' }
                '.gif'  { 'image/gif' }
                '.svg'  { 'image/svg+xml' }
                default { 'application/octet-stream' }
            }
            $response.ContentType = $contentType
            
            $response.OutputStream.Write($content, 0, $content.Length)
        }
        else {
            # File not found
            $response.StatusCode = 404
            $errorMessage = "404 - File Not Found: $requestedPath"
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($errorMessage)
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            
            Write-Host "  -> 404 Not Found" -ForegroundColor Red
        }

        $response.Close()
    }
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
finally {
    if ($http.IsListening) {
        $http.Stop()
    }
    Write-Host ""
    Write-Host "Server stopped." -ForegroundColor Yellow
}
