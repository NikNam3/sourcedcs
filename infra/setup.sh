#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Droplet Bootstrap Script
# Run once on a fresh Fedora droplet to deploy the full stack
# ─────────────────────────────────────────────────────────────
set -e

echo "==> Installing Docker..."
sudo dnf -y install dnf-plugins-core
sudo dnf-3 config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker

echo "==> Installing firewalld..."
sudo dnf install -y firewalld
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload

echo "==> Cloning infra repo..."
# Replace with your actual git repo
# git clone https://github.com/youruser/infra.git /opt/infra
# cd /opt/infra

echo "==> Setting up .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  !! Edit .env with your real values before continuing !!"
  echo "  Run: nano .env"
  echo "  Then re-run this script or: docker compose up -d"
  exit 0
fi

echo "==> Pulling images..."
docker compose pull

echo "==> Starting stack (HTTP only first, for certbot)..."
docker compose up -d nginx mariadb mediawiki casdoor

echo ""
echo "==> Issuing SSL certificates..."
echo "  Make sure DNS A records point to this server first!"
echo ""
read -p "Enter your email for Let's Encrypt: " LE_EMAIL
read -p "Enter your main domain (e.g. sourcedcs.page): " DOMAIN

echo "==> Issuing SSL certificates..."
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  --email "$LE_EMAIL" \
  --agree-tos --no-eff-email \
  -d "wiki.$DOMAIN" \
  -d "auth.$DOMAIN" \
  -d "ato.$DOMAIN" \
  -d "asacs.$DOMAIN" \
  -d "$DOMAIN"

echo "==> Reloading nginx with SSL..."
docker compose exec nginx nginx -s reload

echo "==> Starting certbot auto-renew..."
docker compose up -d certbot

echo "==> Reloading nginx with SSL..."
docker compose exec nginx nginx -s reload

echo ""
echo "✅ Stack is up!"
echo "   Main:     https://$DOMAIN"
echo "   Wiki:     https://wiki.$DOMAIN"
echo "   Auth:     https://auth.$DOMAIN"
echo "   ATO:      https://ato.$DOMAIN"
echo "   CRC-SYNC: https://asacs.$DOMAIN"
echo ""
echo "Next steps:"
echo "  1. Visit https://wiki.$DOMAIN to run MediaWiki web installer"
echo "  2. Upload LocalSettings.php to ./mediawiki/LocalSettings.php"
echo "  3. Uncomment the LocalSettings volume in docker-compose.yml"
echo "  4. docker compose restart mediawiki"
