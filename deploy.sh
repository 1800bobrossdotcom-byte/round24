#!/usr/bin/env bash
# ============================================================
#  Round24 — one-command deploy helper
#  Just run:  bash deploy.sh
#  It checks everything, explains any problem in plain English,
#  and walks you all the way to a live site.
# ============================================================

set -u
BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; ORG=$'\033[38;5;208m'; RST=$'\033[0m'

say()  { printf "%s\n" "$*"; }
ok()   { printf "${GRN}✓${RST} %s\n" "$*"; }
warn() { printf "${YEL}!${RST} %s\n" "$*"; }
err()  { printf "${RED}✗ %s${RST}\n" "$*"; }
step() { printf "\n${BOLD}${ORG}▸ %s${RST}\n" "$*"; }
pause(){ printf "\n${DIM}(press Enter to continue, or Ctrl-C to stop)${RST} "; read -r _; }

clear 2>/dev/null || true
printf "${BOLD}${ORG}"
cat <<'BANNER'
   ___      _ _
  / __\__ _| (_)_ __   ___ _ __
 / /  / _` | | | '_ \ / _ \ '__|
/ /__| (_| | | | |_) |  __/ |
\____/\__,_|_|_| .__/ \___|_|
               |_|   deploy helper
BANNER
printf "${RST}\n"
say "This walks you from code to live website. It won't break anything —"
say "it only reads, installs tools, and asks before each big step."
pause

# ---- 0. make sure we're in the right folder ----
step "Checking we're in the project folder"
if [ ! -f package.json ] || ! grep -q '"name": "round24"' package.json 2>/dev/null; then
  err "This doesn't look like the Round24 folder."
  say ""
  say "Fix: unzip round24-app.zip, then in your terminal type:"
  say "     ${BOLD}cd round24${RST}   (the folder that has package.json inside)"
  say "and run ${BOLD}bash deploy.sh${RST} again from there."
  exit 1
fi
ok "Found the Round24 project."

# ---- 1. Node.js ----
step "Checking for Node.js (the engine that runs the app)"
if ! command -v node >/dev/null 2>&1; then
  err "Node.js isn't installed."
  say ""
  say "Fix: go to ${BOLD}https://nodejs.org${RST}, download the big green ${BOLD}LTS${RST} button,"
  say "install it (just click through), then close and reopen your terminal"
  say "and run ${BOLD}bash deploy.sh${RST} again."
  exit 1
fi
NODE_V=$(node -v)
ok "Node.js is installed ($NODE_V)."
if ! command -v npm >/dev/null 2>&1; then
  err "npm is missing (it normally comes with Node). Reinstall Node from https://nodejs.org."
  exit 1
fi
ok "npm is installed ($(npm -v))."

# ---- 2. dependencies ----
step "Installing the app's building blocks (npm install)"
say "${DIM}First time takes a minute or two. This is normal.${RST}"
if npm install --no-audit --no-fund; then
  ok "All building blocks installed."
else
  err "npm install failed."
  say ""
  say "Most common causes:"
  say "  • No internet connection — check your wifi and try again."
  say "  • A company/school network blocking npm. Try a different network."
  say "  • Try running it once more: ${BOLD}npm install${RST}"
  exit 1
fi

# ---- 3. test build ----
step "Doing a test build to make sure everything compiles"
if npm run build; then
  ok "Build succeeded — the app is healthy."
else
  err "The build hit an error (shown above)."
  say ""
  say "Copy the red error text and send it to me — I'll tell you the exact fix."
  say "Nothing is broken on your computer; this just means a code tweak is needed."
  exit 1
fi

# ---- 4. choose deploy path ----
step "Ready to put it online. Pick how:"
say ""
say "  ${BOLD}1${RST}) Quick deploy with Vercel  ${DIM}(fastest — no GitHub needed)${RST}"
say "  ${BOLD}2${RST}) Just build it, I'll deploy manually later"
say ""
printf "Type 1 or 2 then Enter: "
read -r CHOICE

case "$CHOICE" in
  1)
    step "Setting up Vercel"
    if ! command -v vercel >/dev/null 2>&1; then
      say "Installing the Vercel tool..."
      if ! npm install -g vercel; then
        err "Couldn't install Vercel globally."
        say "Try with elevated permissions: ${BOLD}sudo npm install -g vercel${RST}"
        say "then run ${BOLD}bash deploy.sh${RST} again and pick 1."
        exit 1
      fi
    fi
    ok "Vercel tool ready."
    say ""
    say "${BOLD}What happens next:${RST}"
    say "  • A browser window opens — log in (or sign up, it's free)."
    say "  • Back in the terminal it asks a few setup questions."
    say "    ${DIM}Just press Enter to accept every default — they're correct.${RST}"
    say "  • It deploys a ${BOLD}preview${RST} first, then we push it live."
    pause

    say ""; say "${BOLD}Deploying preview...${RST}"
    if ! vercel; then
      err "The preview deploy didn't finish. Scroll up for the reason, or send it to me."
      exit 1
    fi
    ok "Preview is live!"
    say ""
    printf "Push it to the ${BOLD}real production URL${RST} now? (y/n): "
    read -r GOLIVE
    if [ "$GOLIVE" = "y" ] || [ "$GOLIVE" = "Y" ]; then
      if vercel --prod; then
        printf "\n${GRN}${BOLD}🎉 Your site is LIVE.${RST}\n"
        say "The production URL is shown just above (ends in .vercel.app)."
      else
        err "Production promote failed — send me what it printed."
        exit 1
      fi
    else
      ok "Left it as a preview. Run ${BOLD}vercel --prod${RST} anytime to go live."
    fi

    step "Last step: your custom domain round24.app"
    say "  1. Open ${BOLD}vercel.com${RST} → your project → ${BOLD}Settings → Domains${RST}"
    say "  2. Type ${BOLD}round24.app${RST} and click Add"
    say "  3. In ${BOLD}Namecheap → Advanced DNS${RST}, set these two records:"
    say "        A record   Host ${BOLD}@${RST}     Value ${BOLD}76.76.21.21${RST}"
    say "        CNAME      Host ${BOLD}www${RST}   Value ${BOLD}cname.vercel-dns.com.${RST}"
    say "        ${DIM}(use the exact IP Vercel shows if it differs from mine)${RST}"
    say "  4. Turn OFF Namecheap's ${BOLD}Domain Parking${RST} if it's on."
    say "  The lock icon (SSL) turns on by itself within a few minutes."
    ;;
  2)
    step "Build-only"
    ok "Done — the finished site is in the ${BOLD}dist/${RST} folder."
    say "Whenever you're ready, run ${BOLD}bash deploy.sh${RST} again and pick 1."
    ;;
  *)
    warn "Didn't recognize that choice. Run ${BOLD}bash deploy.sh${RST} again and type 1 or 2."
    exit 1
    ;;
esac

printf "\n${GRN}All done.${RST} Stuck on anything? Copy what the terminal says and send it to me.\n"
