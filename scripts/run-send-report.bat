@echo off
cd /d "C:\New Key"
node scripts\send-daily-report.mjs >> logs\daily-report.log 2>&1
