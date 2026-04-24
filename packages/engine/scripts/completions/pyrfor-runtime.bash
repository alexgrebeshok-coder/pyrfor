#!/usr/bin/env bash
# bash completion for pyrfor-runtime
#
# Install location:
#   System-wide : /etc/bash_completion.d/pyrfor-runtime
#   User (recommended): ~/.local/share/bash-completion/completions/pyrfor-runtime
#
# Load manually (add to ~/.bashrc):
#   source /path/to/pyrfor-runtime.bash
#
# Or use the installer:
#   ./packages/engine/scripts/install.sh --with-completions

_pyrfor_runtime() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    words=("${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  }

  # Top-level subcommands
  local subcommands="service migrate mcp backup restore token"

  # Top-level flags (shared / default run flags)
  local top_flags="--telegram --port --workspace --config --help"

  # Determine the active subcommand (word at position 1)
  local subcmd=""
  if [[ ${#words[@]} -ge 2 ]]; then
    subcmd="${words[1]}"
  fi

  # Determine second-level subcommand (word at position 2)
  local sub2=""
  if [[ ${#words[@]} -ge 3 ]]; then
    sub2="${words[2]}"
  fi

  case "$subcmd" in
    service)
      case "$sub2" in
        install)
          COMPREPLY=($(compgen -W "--env-file --exec --workdir --help" -- "$cur"))
          return 0
          ;;
        uninstall|status)
          COMPREPLY=($(compgen -W "--help" -- "$cur"))
          return 0
          ;;
        *)
          COMPREPLY=($(compgen -W "install uninstall status --help" -- "$cur"))
          return 0
          ;;
      esac
      ;;
    migrate)
      case "$sub2" in
        sessions)
          COMPREPLY=($(compgen -W "--dry-run --overwrite --channel --from --help" -- "$cur"))
          return 0
          ;;
        *)
          COMPREPLY=($(compgen -W "sessions --help" -- "$cur"))
          return 0
          ;;
      esac
      ;;
    mcp)
      COMPREPLY=($(compgen -W "--help" -- "$cur"))
      return 0
      ;;
    backup)
      case "$sub2" in
        list)
          COMPREPLY=($(compgen -W "--help" -- "$cur"))
          return 0
          ;;
        *)
          COMPREPLY=($(compgen -W "list --out --help" -- "$cur"))
          return 0
          ;;
      esac
      ;;
    restore)
      # <archive> is a file argument; offer flags
      case "$prev" in
        restore)
          # First positional: archive file
          COMPREPLY=($(compgen -f -- "$cur"))
          return 0
          ;;
        *)
          COMPREPLY=($(compgen -W "--force --help" -- "$cur"))
          return 0
          ;;
      esac
      ;;
    token)
      case "$sub2" in
        rotate)
          COMPREPLY=($(compgen -W "--label --ttl-days --config --help" -- "$cur"))
          return 0
          ;;
        *)
          COMPREPLY=($(compgen -W "rotate --help" -- "$cur"))
          return 0
          ;;
      esac
      ;;
    *)
      # No subcommand yet — offer subcommands and top-level flags
      if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "$top_flags" -- "$cur"))
      else
        COMPREPLY=($(compgen -W "$subcommands" -- "$cur"))
      fi
      return 0
      ;;
  esac
}

complete -F _pyrfor_runtime pyrfor-runtime
