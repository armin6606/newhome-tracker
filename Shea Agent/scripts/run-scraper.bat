@echo off
cd /d "C:\New Key\Shea Agent"
node scripts/scrape-shea.mjs >> logs\scrape.log 2>&1
