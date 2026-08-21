# General developer and workstation shortcuts.
alias cl='make distclean && clear'
alias md='glowm -no-pager'
alias update-ghostty='/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/mkasberg/ghostty-ubuntu/HEAD/install.sh)"'
alias gpu-on="sudo prime-select on-demand && echo 'GPU set to On-Demand. Please reboot or re-login to apply.'"
alias gpu-max="sudo prime-select nvidia && echo 'GPU set to Always On. Please reboot or re-login to apply.'"
alias gpu-off="sudo prime-select intel && echo 'GPU Disabled (Intel only). Please reboot or re-login to apply.'"
