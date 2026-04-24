#compdef pyrfor-runtime
# zsh completion for pyrfor-runtime
#
# Install location (choose one):
#   System-wide : /usr/share/zsh/site-functions/_pyrfor_runtime
#   User        : ~/.zsh/completions/_pyrfor_runtime
#
# For user install, ensure your ~/.zshrc contains:
#   fpath+=(~/.zsh/completions)
#   autoload -Uz compinit && compinit
#
# Or use the installer:
#   ./packages/engine/scripts/install.sh --with-completions

_pyrfor_runtime() {
  local context state line
  typeset -A opt_args

  _arguments -C \
    '(-h --help)'{-h,--help}'[Show help]' \
    '--telegram[Start in telegram-bot mode]' \
    '--port[Gateway port]:port number:' \
    '--workspace[Workspace directory]:directory:_files -/' \
    '--config[Path to runtime.json]:config file:_files' \
    '1: :_pyrfor_runtime_subcommands' \
    '*:: :->subcommand_args'

  case "$state" in
    subcommand_args)
      case "${words[1]}" in
        service)   _pyrfor_runtime_service ;;
        migrate)   _pyrfor_runtime_migrate ;;
        mcp)       _message 'no further arguments' ;;
        backup)    _pyrfor_runtime_backup ;;
        restore)   _pyrfor_runtime_restore ;;
        token)     _pyrfor_runtime_token ;;
      esac
      ;;
  esac
}

_pyrfor_runtime_subcommands() {
  local -a subcommands
  subcommands=(
    'service:Manage the pyrfor-runtime background service'
    'migrate:Data migration utilities'
    'mcp:Start in MCP (Model Context Protocol) server mode'
    'backup:Create a workspace backup archive'
    'restore:Restore a workspace from a backup archive'
    'token:Manage bearer tokens'
  )
  _describe -t subcommands 'subcommand' subcommands
}

_pyrfor_runtime_service() {
  local -a service_subcmds
  service_subcmds=(
    'install:Register as a background service (launchd / systemd)'
    'uninstall:Remove the background service registration'
    'status:Show current service status'
  )

  _arguments -C \
    '1: :_pyrfor_runtime_service_subcommands' \
    '*:: :->service_sub_args'

  case "$state" in
    service_sub_args)
      case "${words[1]}" in
        install)
          _arguments \
            '--env-file[Path to .env file]:env file:_files' \
            '--exec[Executable path override]:executable:_files' \
            '--workdir[Working directory]:directory:_files -/' \
            '(-h --help)'{-h,--help}'[Show help]'
          ;;
        uninstall|status)
          _arguments '(-h --help)'{-h,--help}'[Show help]'
          ;;
      esac
      ;;
  esac
}

_pyrfor_runtime_service_subcommands() {
  local -a cmds
  cmds=(
    'install:Register as a background service'
    'uninstall:Remove the background service'
    'status:Show service status'
  )
  _describe -t commands 'service subcommand' cmds
}

_pyrfor_runtime_migrate() {
  local -a migrate_subcmds
  migrate_subcmds=('sessions:Migrate legacy session data')

  _arguments -C \
    '1: :_pyrfor_runtime_migrate_subcommands' \
    '*:: :->migrate_sub_args'

  case "$state" in
    migrate_sub_args)
      case "${words[1]}" in
        sessions)
          _arguments \
            '--dry-run[Show what would be migrated without writing]' \
            '--overwrite[Overwrite existing sessions]' \
            '--channel[Channel name override]:channel name:' \
            '--from[Source directory]:directory:_files -/' \
            '(-h --help)'{-h,--help}'[Show help]'
          ;;
      esac
      ;;
  esac
}

_pyrfor_runtime_migrate_subcommands() {
  local -a cmds
  cmds=('sessions:Migrate legacy session store data')
  _describe -t commands 'migrate subcommand' cmds
}

_pyrfor_runtime_backup() {
  _arguments -C \
    '1: :_pyrfor_runtime_backup_subcommands' \
    '--out[Output path for the archive]:output path:_files' \
    '(-h --help)'{-h,--help}'[Show help]' \
    '*:: :->backup_sub_args'

  case "$state" in
    backup_sub_args)
      case "${words[1]}" in
        list) _arguments '(-h --help)'{-h,--help}'[Show help]' ;;
      esac
      ;;
  esac
}

_pyrfor_runtime_backup_subcommands() {
  local -a cmds
  cmds=('list:List available backup archives')
  _describe -t commands 'backup subcommand' cmds "$@"
}

_pyrfor_runtime_restore() {
  _arguments \
    '1:archive file:_files' \
    '--force[Overwrite existing target directory]' \
    '(-h --help)'{-h,--help}'[Show help]'
}

_pyrfor_runtime_token() {
  _arguments -C \
    '1: :_pyrfor_runtime_token_subcommands' \
    '*:: :->token_sub_args'

  case "$state" in
    token_sub_args)
      case "${words[1]}" in
        rotate)
          _arguments \
            '--label[Human-readable label for the token]:label:' \
            '--ttl-days[Token TTL in days]:days:' \
            '--config[Path to runtime.json]:config file:_files' \
            '(-h --help)'{-h,--help}'[Show help]'
          ;;
      esac
      ;;
  esac
}

_pyrfor_runtime_token_subcommands() {
  local -a cmds
  cmds=('rotate:Rotate (regenerate) the gateway bearer token')
  _describe -t commands 'token subcommand' cmds
}

_pyrfor_runtime "$@"
