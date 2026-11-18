@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================
echo 当前工作目录: %cd%
echo 正在执行一键同步到 GitHub...
echo ====================================

git add -A
set /p msg=请输入这次更新的说明（直接回车默认更新）: 
if "%msg%"=="" set msg=auto update
git commit -m "%msg%"
git push origin main

echo.
echo ====================================
echo 同步操作已结束！
echo ====================================
pause
