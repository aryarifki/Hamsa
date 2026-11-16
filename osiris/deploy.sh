#!/bin/bash
# =========================================================
#  OSIRIS — Deploy Cycle Script
#  Git → SSH → Docker Rebuild → Live
# =========================================================
#
#  Usage (from your local osiris project directory):
#    bash deploy.sh                  # deploys current staged changes
#    bash deploy.sh "commit message" # deploys with custom commit message
#
# =========================================================

set -e

# --- Configuration ---
SERVER="root@100.89.48.10"
REMOTE_DIR="/root/osiris"
BRANCH="main"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     OSIRIS DEPLOYMENT CYCLE              ║${NC}"
echo -e "${CYAN}║     Git → SSH → Docker → Live            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# --- STEP 1: Git Commit & Push ---
# osiris/ is a directory of the Hamsa repo on branch `main`, not its own
# repository — the source is pushed there. Do NOT `git add -A` here: the
# workspace holds untracked junk (osiris/off, stray intel/ builds) that
# must never ship.
echo -e "${YELLOW}[1/2] GIT — Pushing tracked source...${NC}"
COMMIT_MSG="${1:-deploy: update osiris production $(date '+%Y-%m-%d %H:%M')}"
git commit -m "$COMMIT_MSG" 2>/dev/null || echo -e "${YELLOW}  (nothing new to commit)${NC}"

git push origin "$BRANCH"
echo -e "${GREEN}  ✓ Pushed to origin/$BRANCH${NC}"
echo ""

# --- STEP 2: SSH — Pull & Docker Rebuild ---
echo -e "${YELLOW}[2/2] SERVER — Pulling & Rebuilding Docker...${NC}"
ssh "$SERVER" "cd $REMOTE_DIR && git pull && docker-compose down && docker-compose up -d --build"
echo -e "${GREEN}  ✓ Docker rebuilt and running${NC}"
echo ""

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     ✅ DEPLOYMENT COMPLETE               ║${NC}"
echo -e "${CYAN}║     https://osirisai.live is live         ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
