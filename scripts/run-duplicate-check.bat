@echo off
cd /d "C:\New Key"
node scripts\check-duplicates.mjs >> logs\duplicate-check.log 2>&1
