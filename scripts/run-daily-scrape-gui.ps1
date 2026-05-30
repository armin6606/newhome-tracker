Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$Repo = "armin6606/newhome-tracker"
$Workflow = "daily-scrape.yml"
$Branch = "main"
$Gh = Join-Path $env:USERPROFILE "Documents\Codex\tools\gh\bin\gh.exe"

function Invoke-Gh {
  param([string[]]$Arguments)

  $output = & $Gh @Arguments 2>&1
  $text = ($output | Out-String).Trim()
  return @{
    Code = $LASTEXITCODE
    Text = $text
  }
}

function Convert-Conclusion {
  param($Conclusion)

  if ([string]::IsNullOrWhiteSpace($Conclusion)) {
    return "not finished"
  }
  return [string]$Conclusion
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "New Key Scrapers Run"
$form.Size = New-Object System.Drawing.Size(912, 560)
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(816, 480)

$title = New-Object System.Windows.Forms.Label
$title.Text = "New Key Scrapers Run"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(18, 16)
$form.Controls.Add($title)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Starting..."
$status.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(840, 26)
$status.Location = New-Object System.Drawing.Point(22, 56)
$form.Controls.Add($status)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(22, 88)
$progress.Size = New-Object System.Drawing.Size(840, 18)
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 35
$form.Controls.Add($progress)

$log = New-Object System.Windows.Forms.TextBox
$log.Location = New-Object System.Drawing.Point(22, 122)
$log.Size = New-Object System.Drawing.Size(840, 335)
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = "Vertical"
$log.Font = New-Object System.Drawing.Font("Consolas", 9)
$log.Anchor = "Top,Bottom,Left,Right"
$form.Controls.Add($log)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = "Close"
$closeButton.Size = New-Object System.Drawing.Size(92, 32)
$closeButton.Location = New-Object System.Drawing.Point(770, 472)
$closeButton.Anchor = "Bottom,Right"
$closeButton.Enabled = $false
$closeButton.Add_Click({ $form.Close() })
$form.Controls.Add($closeButton)

function Add-Log {
  param([string]$Message)

  $stamp = Get-Date -Format "HH:mm:ss"
  $log.AppendText("[$stamp] $Message`r`n")
  $log.SelectionStart = $log.Text.Length
  $log.ScrollToCaret()
}

function Finish-Run {
  param(
    [string]$Message,
    [bool]$Success
  )

  $script:Done = $true
  $timer.Stop()
  $progress.MarqueeAnimationSpeed = 0
  $progress.Style = "Continuous"
  $progress.Value = 100
  $status.Text = $Message
  if ($Success) {
    $status.ForeColor = [System.Drawing.Color]::ForestGreen
    Add-Log "SUCCESS: $Message"
  } else {
    $status.ForeColor = [System.Drawing.Color]::Firebrick
    Add-Log "FAILED: $Message"
  }
  $closeButton.Enabled = $true
  $closeButton.Focus()
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000

$script:RunId = $null
$script:RunUrl = $null
$script:StartedAfter = $null
$script:Done = $false
$script:LastJobSummary = ""

$timer.Add_Tick({
  if ($script:Done) {
    return
  }

  try {
    if (-not $script:RunId) {
      $status.Text = "Finding the GitHub Actions run..."
      $result = Invoke-Gh @(
        "run", "list",
        "--repo", $Repo,
        "--workflow", $Workflow,
        "--event", "workflow_dispatch",
        "--limit", "10",
        "--json", "databaseId,createdAt,status,conclusion,url"
      )

      if ($result.Code -ne 0) {
        Add-Log "Could not list workflow runs yet: $($result.Text)"
        return
      }

      $runs = $result.Text | ConvertFrom-Json
      $newRun = $runs |
        Where-Object { ([datetime]$_.createdAt).ToUniversalTime() -ge $script:StartedAfter } |
        Sort-Object { [datetime]$_.createdAt } -Descending |
        Select-Object -First 1

      if (-not $newRun) {
        Add-Log "Waiting for GitHub to create the workflow run..."
        return
      }

      $script:RunId = [string]$newRun.databaseId
      $script:RunUrl = [string]$newRun.url
      Add-Log "GitHub run created: $script:RunId"
      Add-Log $script:RunUrl
    }

    $view = Invoke-Gh @(
      "run", "view", $script:RunId,
      "--repo", $Repo,
      "--json", "status,conclusion,url,jobs"
    )

    if ($view.Code -ne 0) {
      Add-Log "Could not read run status yet: $($view.Text)"
      return
    }

    $run = $view.Text | ConvertFrom-Json
    $jobs = @($run.jobs)
    $jobSummary = ($jobs | ForEach-Object {
      "$($_.name): $($_.status)/$(Convert-Conclusion $_.conclusion)"
    }) -join " | "

    if ($jobSummary -and $jobSummary -ne $script:LastJobSummary) {
      $script:LastJobSummary = $jobSummary
      Add-Log $jobSummary
    }

    $runningJob = $jobs |
      Where-Object { $_.status -eq "in_progress" -or $_.status -eq "queued" -or $_.status -eq "waiting" } |
      Select-Object -First 1

    if ($runningJob) {
      $status.Text = "Processing: $($runningJob.name)"
    } else {
      $status.Text = "Processing: GitHub Actions is updating status..."
    }

    if ($run.status -eq "completed") {
      if ($run.conclusion -eq "success") {
        Finish-Run "Scrapers finished successfully." $true
      } else {
        Finish-Run "Scrapers finished with result: $($run.conclusion)." $false
      }
    }
  } catch {
    Add-Log "Status check error: $($_.Exception.Message)"
  }
})

$form.Add_Shown({
  Add-Log "Starting NewKey.us Daily Scrape on GitHub Actions..."

  if (-not (Test-Path $Gh)) {
    Finish-Run "GitHub CLI was not found at $Gh." $false
    return
  }

  $script:StartedAfter = (Get-Date).ToUniversalTime().AddSeconds(-20)
  $status.Text = "Requesting manual scraper run..."

  try {
    $start = Invoke-Gh @(
      "workflow", "run", $Workflow,
      "--repo", $Repo,
      "--ref", $Branch
    )

    if ($start.Code -ne 0) {
      Finish-Run "GitHub rejected the manual run. $($start.Text)" $false
      return
    }

    Add-Log "Manual run accepted by GitHub."
    $timer.Start()
  } catch {
    Finish-Run "Could not start the scraper run. $($_.Exception.Message)" $false
  }
})

[void]$form.ShowDialog()
