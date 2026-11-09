@echo off
cd /d "%~dp0.."
rem localhost resolves to IPv6 (::1) on some Windows setups; Remotion serves on IPv4
set NODE_OPTIONS=--dns-result-order=ipv4first
npx remotion studio src/index.ts
