#!/bin/bash
# EchoLink - Folder Structure Generator
# Run: bash generate-structure.sh

echo "🔷 EchoLink — Generating Project Structure..."

PROJECT="echolink"

mkdir -p $PROJECT/public/css
mkdir -p $PROJECT/public/js
mkdir -p $PROJECT/public/assets
mkdir -p $PROJECT/db
mkdir -p $PROJECT/uploads

# Create placeholder files
touch $PROJECT/server.js
touch $PROJECT/package.json
touch $PROJECT/Dockerfile
touch $PROJECT/README.md
touch $PROJECT/.env.example
touch $PROJECT/public/index.html
touch $PROJECT/public/css/styles.css
touch $PROJECT/public/js/app.js
touch $PROJECT/db/.gitkeep
touch $PROJECT/uploads/.gitkeep

# Create .env.example
cat > $PROJECT/.env.example << 'EOF'
PORT=3000
JWT_SECRET=change-me-in-production
DB_PATH=./db/echolink.db
EOF

# Create .gitignore
cat > $PROJECT/.gitignore << 'EOF'
node_modules/
db/*.db
uploads/*
!uploads/.gitkeep
.env
EOF

echo ""
echo "✅ Structure created:"
find $PROJECT -type f | sort | sed 's/^/   /'
echo ""
echo "Next steps:"
echo "  cd $PROJECT"
echo "  npm install"
echo "  npm start"
