@echo off
cd /d "C:\New Key"
node scripts/sync-community-counts.mjs >> logs\sync-counts.log 2>&1
