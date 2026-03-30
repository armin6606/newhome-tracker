@echo off
cd /d "C:\New Key\Lennar Agent"
node scripts/scrape-lennar.mjs >> logs\scrape.log 2>&1
