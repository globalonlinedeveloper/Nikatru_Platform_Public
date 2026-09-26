# backup-offsite.ps1 FIXTURE for tooling/ci/test/backup-headroom.test.mjs.
# A hand-written excerpt with the shape of the real set table (Private
# runbooks/config/backup-offsite.ps1): the $REPO_CHURN and $repoChurnSkip lines,
# $rescueLeaf, a first $jobs table holding one set of each Src form, a set with no
# Max, comments inside a hashtable and inside an array, and a SECOND $jobs table
# after it that the pre-flight never counts. Never run; only parsed.

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$repoLeaf    = Split-Path $repo -Leaf
$rescueLeaf = 'rescued-from-archive-fixture'
$rescuePath = Join-Path $projectsRoot $rescueLeaf

$REPO_CHURN = @('.git', 'node_modules', 'build', '.dart_tool', 'dist', '.mason', '.worktrees')

$repoChurnFilter = @()
foreach ($d in $REPO_CHURN) { $repoChurnFilter += @('--exclude', "$d/**", '--exclude', "**/$d/**") }
$repoChurnSkip = @($REPO_CHURN | ForEach-Object { "*\$_\*" })

$jobs = @(
    # a comment between entries
    @{ Name='platform repo';    Src=$repo;                                Dest="gbiz:fixture/$repoLeaf"; Probe='pnpm-workspace.yaml';
       Verb='sync'; Max=100; MaxDelete=10;
       # a comment inside a hashtable, as the real table has
       Filter=(@('--exclude', '.claude/**', '--exclude', '**/.claude/**') + $repoChurnFilter);
       Skip=(@('*\.claude\*') + $repoChurnSkip) },
    @{ Name='.claude vault';    Src=(Join-Path $repo '.claude');          Dest="gbiz:fixture/$repoLeaf/.claude"; Probe='vault.probe'; Max=10; Verb='sync'; MaxDelete=2;
       Exclude=@('--exclude', 'vault.bak*');
       VerifyExclude=@('--exclude', 'backup-logs/**', '--exclude', 'vault.bak*') },
    @{ Name='brain';            Src=$brainPath;                           Dest="gbiz:fixture/$brainLeaf"; Probe='business/company-master.md';
       Verb='sync'; Max=20; MaxDelete=5; AtticDays=90;
       Filter=(@('--exclude', 'personal/**') + $repoChurnFilter);
       Skip=(@('*\personal\*') + $repoChurnSkip) },
    @{ Name='rescued archive';  Src=$rescuePath;                          Dest="gbiz:fixture/$rescueLeaf"; Probe='rescued.bundle';
       Verb='copy'; Max=10 },
    @{ Name='platform private'; Src=$privatePath;                         Dest="gbiz:fixture/$privateDestLeaf"; Probe='runbooks/backup-restore.md';
       Verb='sync'; Max=50; MaxDelete=10; AtticDays=90;
       Filter=$repoChurnFilter; Skip=$repoChurnSkip },
    @{ Name='transcripts';      Src="$env:USERPROFILE\.claude\projects";  Dest='gbiz:fixture/projects'; Probe='MEMORY.md'; Verb='copy';
       Filter=@(
         '--include', 'slug-one/**',
         # a comment inside an array, as the real Filter list has
         '--include', 'slug-two/**'
       ) },
    @{ Name='scheduled-tasks';  Src="$env:USERPROFILE\.claude\scheduled-tasks"; Dest='gbiz:fixture/scheduled-tasks';
       Probe='driver/SKILL.md'; Max=200; Verb='sync'; MaxDelete=5; AtticDays=365 },
    @{ Name='settings.json';    Src="$env:USERPROFILE\.claude\settings.json";   Dest='gbiz:fixture'; Probe='settings.json'; Verb='copy' }
)

function Get-BackupFiles {
    param([string]$Path, [string[]]$Skip = @(), [string[]]$Keep = @())
    # the real function lives in the real script; the parity test runs that one
}

# The git-bundles table: a different table, added after the pre-flight.
$jobs = @(
    @{
        Name  = 'git bundles'
        Src   = $bundleDir
        Dest  = 'gbiz:fixture/bundles'
        Probe = 'code.bundle'
        Max   = 3
    }
)
