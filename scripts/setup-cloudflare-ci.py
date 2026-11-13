#!/usr/bin/env python3
"""One human-only step: securely authorize deployment from GitHub.
No token is written to disk, shell arguments, logs, or this repository.
"""
import getpass
import subprocess
import sys
secret = getpass.getpass('Cloudflare deployment API token (hidden): ').strip()
if not secret:
    sys.exit('No token entered; nothing changed.')
result = subprocess.run(['gh', 'secret', 'set', 'CLOUDFLARE_API_TOKEN', '--repo', 'KartikeyaBomb/pomopomo'], input=secret, text=True, capture_output=True)
if result.returncode:
    sys.exit('Could not save the repository secret. Check gh auth status.')
secret = ''
print('Deployment credential saved securely in GitHub Actions.')
run = subprocess.run(['gh', 'workflow', 'run', 'deploy-cloudflare.yml', '--repo', 'KartikeyaBomb/pomopomo', '--ref', 'main'], capture_output=True)
print('Deployment started. Run: gh run list --repo KartikeyaBomb/pomopomo --limit 3' if run.returncode == 0 else 'The credential is ready. Deployment will start when the workflow is pushed to main.')
