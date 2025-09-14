# Local Staff Scheduling Optimizer

## 🚀 Quick Start Guide

### Windows Users:
1. Extract this ZIP file to any folder
2. Double-click: start_local_solver.bat
3. Keep the window open while using your webapp
4. Your webapp will automatically use this high-performance local solver!

### Mac/Linux Users:
1. Extract this ZIP file to any folder  
2. Open terminal in the extracted folder
3. Run: chmod +x start_local_solver.sh
4. Run: ./start_local_solver.sh
5. Keep the terminal open while using your webapp

## 📁 Files Included

### Main Launchers:
- start_local_solver.bat    (Windows launcher)
- start_local_solver.sh     (Mac/Linux launcher)

### Solver Components:
- fastapi_solver_service.py (RECOMMENDED - Advanced solver)
- local_solver.py          (Fallback solver)
- scheduler_sat_core.py     (Core optimization engine)

## ⚡ Performance Features

The advanced solver (fastapi_solver_service.py) provides:
- Multi-threaded OR-Tools optimization
- WebSocket real-time progress updates
- Advanced constraint handling
- Automatic testcase_gui.py detection (if available)
- REST API endpoints for integration

## 🔧 Advanced Usage

### For Maximum Performance:
If you have testcase_gui.py, place it in the PARENT folder
of where you extracted these files. The advanced solver will
automatically detect and use it for even better optimization!

### API Endpoints (when running):
- http://localhost:8000/health   (Check if running)
- http://localhost:8000/docs     (API documentation)
- http://localhost:8000/solve    (Optimization endpoint)

## 🛠 Troubleshooting

### Dependencies:
The launcher automatically installs required Python packages:
- fastapi, uvicorn, websockets, python-multipart
- ortools (Google OR-Tools for optimization)
- openpyxl, colorama (for Excel export and colored output)

### System Requirements:
- Python 3.8+ (download from python.org if needed)
- Internet connection (for initial package installation)
- 2GB+ RAM recommended for large schedules

### Common Issues:
- If you see "Python not found": Install Python from python.org
- If packages fail to install: Try running as administrator
- If webapp can't connect: Check firewall allows localhost:8000

## 📞 Support

This is a high-performance local solver for staff scheduling.
It uses Google OR-Tools constraint programming for optimal solutions.

Generated: 14.09.2025  1:10:02,09
