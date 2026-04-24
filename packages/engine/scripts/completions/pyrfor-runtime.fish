# fish completion for pyrfor-runtime
#
# Install location:
#   ~/.config/fish/completions/pyrfor-runtime.fish
#
# Reload without restarting fish:
#   source ~/.config/fish/completions/pyrfor-runtime.fish
#
# Or use the installer:
#   ./packages/engine/scripts/install.sh --with-completions

# ── helpers ────────────────────────────────────────────────────────────────

# Returns true when no subcommand has been given yet
function __pyrfor_no_subcommand
  set -l tokens (commandline -opc)
  set -l subcmds service migrate mcp backup restore token
  for tok in $tokens[2..]
    if contains -- $tok $subcmds
      return 1
    end
  end
  return 0
end

# Returns true when the first token after the command equals $argv[1]
function __pyrfor_using_subcommand
  set -l tokens (commandline -opc)
  test (count $tokens) -ge 2; and test $tokens[2] = $argv[1]
end

# Returns true when using `service <sub>`
function __pyrfor_service_using
  set -l tokens (commandline -opc)
  test (count $tokens) -ge 3; and test $tokens[2] = service; and test $tokens[3] = $argv[1]
end

# Returns true when using `migrate sessions`
function __pyrfor_migrate_using
  set -l tokens (commandline -opc)
  test (count $tokens) -ge 3; and test $tokens[2] = migrate; and test $tokens[3] = $argv[1]
end

# Returns true when using `token rotate`
function __pyrfor_token_using
  set -l tokens (commandline -opc)
  test (count $tokens) -ge 3; and test $tokens[2] = token; and test $tokens[3] = $argv[1]
end

# ── top-level subcommands ──────────────────────────────────────────────────
complete -c pyrfor-runtime -f -n '__pyrfor_no_subcommand' -a service  -d 'Manage the pyrfor-runtime background service'
complete -c pyrfor-runtime -f -n '__pyrfor_no_subcommand' -a migrate  -d 'Data migration utilities'
complete -c pyrfor-runtime -f -n '__pyrfor_no_subcommand' -a mcp      -d 'Start in MCP server mode'
complete -c pyrfor-runtime -f -n '__pyrfor_no_subcommand' -a backup   -d 'Create a workspace backup archive'
complete -c pyrfor-runtime -f -n '__pyrfor_no_subcommand' -a restore  -d 'Restore workspace from a backup archive'
complete -c pyrfor-runtime -f -n '__pyrfor_no_subcommand' -a token    -d 'Manage bearer tokens'

# ── top-level flags ────────────────────────────────────────────────────────
complete -c pyrfor-runtime -n '__pyrfor_no_subcommand' -l telegram  -d 'Start in telegram-bot mode'
complete -c pyrfor-runtime -n '__pyrfor_no_subcommand' -l port      -d 'Gateway port' -r
complete -c pyrfor-runtime -n '__pyrfor_no_subcommand' -l workspace -d 'Workspace directory' -r -a '(__fish_complete_directories)'
complete -c pyrfor-runtime -n '__pyrfor_no_subcommand' -l config    -d 'Path to runtime.json' -r -a '(__fish_complete_path)'
complete -c pyrfor-runtime -n '__pyrfor_no_subcommand' -l help      -d 'Show help'

# ── service subcommands ────────────────────────────────────────────────────
complete -c pyrfor-runtime -f -n '__pyrfor_using_subcommand service' -a install   -d 'Register as a background service'
complete -c pyrfor-runtime -f -n '__pyrfor_using_subcommand service' -a uninstall -d 'Remove the background service'
complete -c pyrfor-runtime -f -n '__pyrfor_using_subcommand service' -a status    -d 'Show service status'

# service install flags
complete -c pyrfor-runtime -n '__pyrfor_service_using install' -l env-file -d 'Path to .env file'  -r -a '(__fish_complete_path)'
complete -c pyrfor-runtime -n '__pyrfor_service_using install' -l exec     -d 'Executable override' -r -a '(__fish_complete_path)'
complete -c pyrfor-runtime -n '__pyrfor_service_using install' -l workdir  -d 'Working directory'   -r -a '(__fish_complete_directories)'
complete -c pyrfor-runtime -n '__pyrfor_service_using install' -l help     -d 'Show help'

complete -c pyrfor-runtime -n '__pyrfor_service_using uninstall' -l help -d 'Show help'
complete -c pyrfor-runtime -n '__pyrfor_service_using status'    -l help -d 'Show help'

# ── migrate subcommands ────────────────────────────────────────────────────
complete -c pyrfor-runtime -f -n '__pyrfor_using_subcommand migrate' -a sessions -d 'Migrate legacy session store data'

# migrate sessions flags
complete -c pyrfor-runtime -n '__pyrfor_migrate_using sessions' -l dry-run   -d 'Show what would be migrated'
complete -c pyrfor-runtime -n '__pyrfor_migrate_using sessions' -l overwrite -d 'Overwrite existing sessions'
complete -c pyrfor-runtime -n '__pyrfor_migrate_using sessions' -l channel   -d 'Channel name override' -r
complete -c pyrfor-runtime -n '__pyrfor_migrate_using sessions' -l from      -d 'Source directory' -r -a '(__fish_complete_directories)'
complete -c pyrfor-runtime -n '__pyrfor_migrate_using sessions' -l help      -d 'Show help'

# ── mcp ───────────────────────────────────────────────────────────────────
complete -c pyrfor-runtime -n '__pyrfor_using_subcommand mcp' -l help -d 'Show help'

# ── backup ────────────────────────────────────────────────────────────────
complete -c pyrfor-runtime -f -n '__pyrfor_using_subcommand backup' -a list -d 'List available backup archives'
complete -c pyrfor-runtime -n '__pyrfor_using_subcommand backup' -l out  -d 'Output path for the archive' -r -a '(__fish_complete_path)'
complete -c pyrfor-runtime -n '__pyrfor_using_subcommand backup' -l help -d 'Show help'

# ── restore ───────────────────────────────────────────────────────────────
complete -c pyrfor-runtime -n '__pyrfor_using_subcommand restore' -l force -d 'Overwrite existing target directory'
complete -c pyrfor-runtime -n '__pyrfor_using_subcommand restore' -l help  -d 'Show help'

# ── token subcommands ─────────────────────────────────────────────────────
complete -c pyrfor-runtime -f -n '__pyrfor_using_subcommand token' -a rotate -d 'Rotate the gateway bearer token'

# token rotate flags
complete -c pyrfor-runtime -n '__pyrfor_token_using rotate' -l label    -d 'Human-readable label for the token' -r
complete -c pyrfor-runtime -n '__pyrfor_token_using rotate' -l ttl-days -d 'Token TTL in days' -r
complete -c pyrfor-runtime -n '__pyrfor_token_using rotate' -l config   -d 'Path to runtime.json' -r -a '(__fish_complete_path)'
complete -c pyrfor-runtime -n '__pyrfor_token_using rotate' -l help     -d 'Show help'
