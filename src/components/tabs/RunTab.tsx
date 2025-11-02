'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScheduling } from '@/context/SchedulingContext';
import { useSchedulingResults } from '@/context/SchedulingResultsContext';
import { 
  IoRocketSharp,
  IoSettingsSharp,
  IoPlaySharp,
  IoFolderOpenSharp,
  IoTerminalSharp,
  IoTimerSharp,
  IoPowerSharp,
  IoSync,
  IoCheckmarkDoneSharp,
  IoWarningSharp,
  IoCloudSharp,
  IoStopSharp,
  IoDownloadSharp,
  IoDesktopSharp,
  // IoServerSharp,
  IoCodeSlash
} from 'react-icons/io5';
import { 
  SiApple,
  SiLinux
} from 'react-icons/si';
import LocalSolverGuideModal from '@/components/LocalSolverGuideModal';
import DataManagementModal from '@/components/DataManagementModal';
import ResultsManager from '@/components/ResultsManager';
import { generateMonth, getMonthRange } from '@/lib/scheduling';
import { Provider, SchedulingCase } from '@/types/scheduling';


interface SolverResult {
  status: string;
  message: string;
  run_id?: string;
  progress?: number;
  results?: unknown;
  solver_service_url?: string;
  websocket_url?: string;
  polling_url?: string;
  statistics?: Record<string, unknown>;
  error?: string;
  instructions?: Record<string, unknown>;
  output_directory?: string;
  packaged_files?: unknown; // Added to make type explicit
}

// Minimal shapes for solver/health metadata used by this component
interface SolverInfo {
  type: 'local' | 'serverless';
  solver_type?: string;
  capabilities?: string[];
  ortools_available?: boolean;
}

interface LocalHealthResponse {
  status?: string;
  message?: string;
  solver_type?: string;
  ortools_available?: boolean;
  capabilities?: string[];
}

export default function RunTab() {
  const { state, dispatch } = useScheduling();
  const { setResults: setSchedulingResults } = useSchedulingResults();
  const { case: schedulingCase, lastResults } = state;
  
  // Persist solver state in localStorage (task-oriented, survives page refresh)
  const [isRunning, setIsRunning] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('solver-running');
      return saved === 'true';
    }
    return false;
  });
  
  const [progress, setProgress] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('solver-progress');
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });
  
  // Persist logs in localStorage
  const [logs, setLogs] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('solver-logs');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return [`${new Date().toLocaleTimeString()} [INFO] Ready to run optimization...`];
        }
      }
    }
    return [`${new Date().toLocaleTimeString()} [INFO] Ready to run optimization...`];
  });
  
  const [solverState, setSolverState] = useState<'ready' | 'connecting' | 'running' | 'finished' | 'error'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('solver-state') as 'ready' | 'connecting' | 'running' | 'finished' | 'error' | null;
      return saved || 'ready';
    }
    return 'ready';
  });
  const [runId, setRunId] = useState<string | null>(null);
  const [localSolverAvailable, setLocalSolverAvailable] = useState<boolean | null>(null);
  const [solverInfo, setSolverInfo] = useState<SolverInfo | null>(null);
  const [showInstallMenu, setShowInstallMenu] = useState(false);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync state to localStorage whenever it changes (task-oriented persistence)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('solver-running', String(isRunning));
    }
  }, [isRunning]);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('solver-progress', String(progress));
    }
  }, [progress]);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('solver-state', solverState);
    }
  }, [solverState]);
  
  const [installationStatus, setInstallationStatus] = useState<{
    checked: boolean;
    filesInstalled: boolean;
    pythonAvailable: boolean;
    lastChecked: string | null;
    installedFiles: string[];
    missingFiles: string[];
  }>({
    checked: false,
    filesInstalled: false,
    pythonAvailable: false,
    lastChecked: null,
    installedFiles: [],
    missingFiles: []
  });
  const [isCheckingInstallation, setIsCheckingInstallation] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showDataManagementModal, setShowDataManagementModal] = useState(false);
  const [showResultsManager, setShowResultsManager] = useState(false);
  const [guidePlatform, setGuidePlatform] = useState<'windows' | 'mac' | 'linux'>('windows');
  // Month selector state (for Run Settings)
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [isMonthSelectionLocked, setIsMonthSelectionLocked] = useState<boolean>(false);
  const [appliedMonth, setAppliedMonth] = useState<number | null>(null);
  const [appliedYear, setAppliedYear] = useState<number | null>(null);
  
  // Output files state
  const [availableFiles, setAvailableFiles] = useState<Array<{
    name: string;
    size: number;
    modified: string;
    downloadUrl: string;
    isFolder?: boolean;
    fileCount?: number;
  }>>([]);
  const [showFilesMenu, setShowFilesMenu] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const installMenuRef = useRef<HTMLDivElement>(null);
  const portalMenuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 320 });

  // Close install menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const anchor = installMenuRef.current;
      const menu = portalMenuRef.current;
      if (
        showInstallMenu &&
        anchor &&
        menu &&
        !anchor.contains(target) &&
        !menu.contains(target)
      ) {
        setShowInstallMenu(false);
      }
    };

    const updateMenuPosition = () => {
      const anchor = installMenuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      // Position the menu below the button, aligned to left
      setMenuPosition({ top: Math.round(rect.bottom + 8), left: Math.round(rect.left), width: Math.round(rect.width || 320) });
    };

    if (showInstallMenu) {
      updateMenuPosition();
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', updateMenuPosition);
      window.addEventListener('scroll', updateMenuPosition, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [showInstallMenu]);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      info: '[INFO]',
      success: '[SUCCESS]', 
      error: '[ERROR]',
      warning: '[WARNING]'
    }[type];

    // If message already contains a bracketed level like [SUCCESS], don't duplicate
    const sanitizedMessage = message.match(/^\[.*\]\s*/)? message.replace(/^\[.*?\]\s*/, '') : message;

    setLogs(prev => {
      const newLogs = [...prev, `${timestamp} ${prefix} ${sanitizedMessage}`];
      // Save to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('solver-logs', JSON.stringify(newLogs));
      }
      return newLogs;
    });
  }, []);

  // Clear logs function - also resets stuck state
  const clearLogs = useCallback(() => {
    const initialLog = `${new Date().toLocaleTimeString()} [INFO] Ready to run optimization...`;
    setLogs([initialLog]);
    
    // Clear logs from localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('solver-logs', JSON.stringify([initialLog]));
    }
  }, []);

  // Check local solver availability on component mount
  const checkLocalSolverAvailability = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8000/health', {
        signal: AbortSignal.timeout(2000)
      });
      
      if (response.ok) {
        const info: LocalHealthResponse = await response.json();
        setLocalSolverAvailable(true);

        // Build a robust solverInfo with fallbacks when the health endpoint doesn't provide capabilities
        const fallbackLocalCapabilities = [
          'OR-Tools constraint programming (when installed)',
          'Multi-solution generation and evaluation',
          'Advanced optimization heuristics and search',
          'High-performance local execution',
        ];

        // Some local services (FastAPI) may not include a capabilities array in /health
        const normalizedInfo: SolverInfo = {
          type: 'local',
          solver_type: info.solver_type || 'local_enhanced',
          capabilities:
            Array.isArray(info.capabilities) && info.capabilities.length > 0
              ? info.capabilities
              : fallbackLocalCapabilities,
          ortools_available: info.ortools_available,
        };

        setSolverInfo(normalizedInfo);
        addLog(
          `STATUS: Local high-performance mode active${normalizedInfo.solver_type ? `: ${normalizedInfo.solver_type}` : ''}`,
          'success'
        );
        if (normalizedInfo.ortools_available) {
          addLog('STATUS: OR-Tools optimization engine available', 'success');
        }
      } else {
        setLocalSolverAvailable(false);
        // Set fallback serverless solver info
        setSolverInfo({
          type: 'serverless',
          solver_type: 'serverless_js',
          capabilities: [
            'Pure JavaScript/TypeScript implementation',
            'No external dependencies required',
            'Multi-solution generation with constraint satisfaction',
            'Provider workload balancing and availability checking',
            'Daily and weekly shift limit enforcement',
            'Cross-platform compatibility',
            'Vercel serverless function compatible'
          ]
        });
      }
    } catch {
      setLocalSolverAvailable(false);
      addLog('INFO: Local mode not active - using serverless mode', 'info');
      // Set fallback serverless solver info for display
      setSolverInfo({
        type: 'serverless',
        solver_type: 'serverless_js',
        capabilities: [
          'Pure JavaScript/TypeScript implementation',
          'No external dependencies required',
          'Multi-solution generation with constraint satisfaction',
          'Provider workload balancing and availability checking',
          'Daily and weekly shift limit enforcement',
          'Cross-platform compatibility',
          'Vercel serverless function compatible'
        ]
      });
    }
  }, [addLog]);

  // Real-time log streaming from AWS solver
  useEffect(() => {
    if (!runId) return;

    const eventSource = new EventSource(`/api/logs/${runId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          addLog(data.message, data.level || 'info');
        }
      } catch (error) {
        console.error('Failed to parse log event:', error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, addLog]);

  // Installation status management functions
  const STORAGE_KEY = 'localSolverInstallationStatus';

  const loadInstallationStatus = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const status = JSON.parse(stored);
        setInstallationStatus(status);
        return status;
      }
    } catch (error) {
      console.warn('Failed to load installation status:', error);
    }
    return null;
  }, []);

  const saveInstallationStatus = useCallback((status: typeof installationStatus) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
      setInstallationStatus(status);
    } catch (error) {
      console.warn('Failed to save installation status:', error);
    }
  }, []);

  const clearInstallationStatus = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setInstallationStatus({
        checked: false,
        filesInstalled: false,
        pythonAvailable: false,
        lastChecked: null,
        installedFiles: [],
        missingFiles: []
      });
      addLog('Installation status cleared', 'info');
    } catch (error) {
      console.warn('Failed to clear installation status:', error);
    }
  }, [addLog]);

  // Check if required files exist and local server is running
  const checkInstallationStatus = useCallback(async () => {
    if (isCheckingInstallation) return;
    
    setIsCheckingInstallation(true);
    addLog('STATUS: Checking local mode setup...', 'info');

    const requiredFiles = [
      'local_solver.py',
      'start_local_solver.bat',
      'start_local_solver.sh'
    ];

    const installedFiles: string[] = [];
    const missingFiles: string[] = [];
    let serverRunning = false;

    // Check if files are available in public folder (downloadable)
    for (const file of requiredFiles) {
      try {
        const response = await fetch(`/${file}`, { method: 'HEAD' });
        if (response.ok) {
          installedFiles.push(file);
          addLog(`FOUND: ${file}`, 'success');
        } else {
          missingFiles.push(file);
          addLog(`MISSING: ${file}`, 'error');
        }
      } catch {
        missingFiles.push(file);
        addLog(`ACCESS ERROR: Cannot access ${file}`, 'error');
      }
    }

    // Check if local server is actually running
    try {
      const response = await fetch('http://localhost:8000/health', {
        signal: AbortSignal.timeout(3000)
      });
      
      if (response.ok) {
        serverRunning = true;
        addLog('OK: Local server is running on localhost:8000', 'success');
      } else {
        addLog('WARNING: Local server not responding', 'warning');
      }
    } catch {
      addLog('WARNING: Local server not running', 'warning');
    }

    const newStatus = {
      checked: true,
      filesInstalled: missingFiles.length === 0,
      pythonAvailable: serverRunning, // Server running = ready to use
      lastChecked: new Date().toISOString(),
      installedFiles,
      missingFiles
    };

    saveInstallationStatus(newStatus);
    
    if (newStatus.filesInstalled && serverRunning) {
      addLog('READY: Local mode is fully ready!', 'success');
      addLog('STATUS: You can now use the "Local" run option for high performance!', 'success');
      // Auto-refresh page when everything is detected as working
      setTimeout(() => {
        addLog('STATUS: Refreshing page to update interface...', 'success');
        window.location.reload();
      }, 2000);
    } else if (newStatus.filesInstalled && !serverRunning) {
      addLog('INFO: Files are installed but server is not running', 'info');
      addLog('ACTION: Start the local server by running the downloaded script', 'info');
    } else {
      addLog(`WARNING: Missing ${missingFiles.length} required files`, 'warning');
      addLog('ACTION: Use "Enable Local Solver" to download missing files first', 'info');
    }

    setIsCheckingInstallation(false);
  }, [addLog, saveInstallationStatus, isCheckingInstallation]);

  useEffect(() => {
    checkLocalSolverAvailability();
    // Load saved installation status
    loadInstallationStatus();
  }, [checkLocalSolverAvailability, loadInstallationStatus]);

  // Auto-scroll logs to bottom
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  // Cleanup on unmount (simplified for serverless)
  useEffect(() => {
    return () => {
      // No cleanup needed for serverless approach
    };
  }, []);

  // Resume polling for any active AWS job after page refresh
  useEffect(() => {
    const savedRunId = localStorage.getItem('aws_solver_run_id');
    const savedStartTime = localStorage.getItem('aws_solver_start_time');
    
    if (!savedRunId || !savedStartTime) return;
    
    const startTime = parseInt(savedStartTime, 10);
    const elapsed = Date.now() - startTime;
    const maxRunTime = 12 * 60 * 60 * 1000; // 12 HOURS
    
    // Only resume if job started less than 12 hours ago
    if (elapsed >= maxRunTime) {
      // Job too old, clear it
      localStorage.removeItem('aws_solver_run_id');
      localStorage.removeItem('aws_solver_start_time');
      localStorage.removeItem('solver-running');
      localStorage.removeItem('solver-state');
      addLog('[INFO] Previous job expired (older than 12 hours)', 'info');
      return;
    }
    
    // Check if there's actually a job to resume (look at localStorage, not timer ref)
    // If timer is running, we're already polling - don't restart
    if (pollingTimerRef.current && isRunning) {
      // Already actively polling, don't restart
      return;
    }
    
    // Add separator and resume message
    addLog('═══════════════════════════════════════════════════', 'info');
    addLog(`🔄 AUTO-RESUMING job: ${savedRunId}`, 'info');
    addLog(`⏱️  Job has been running for ${Math.round(elapsed / 60000)} minutes`, 'info');
    addLog('Continuing to poll for updates...', 'info');
    addLog('═══════════════════════════════════════════════════', 'info');
    
    setIsRunning(true);
    setSolverState('running');
    
    // Start polling for this job
    const resumePolling = async () => {
      try {
        const AWS_SOLVER_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
        if (!AWS_SOLVER_URL) {
          addLog('[ERROR] AWS Solver URL not configured', 'error');
          return;
        }
        
        const statusResponse = await fetch(`${AWS_SOLVER_URL}/status/${savedRunId}`);
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          
          if (status.status === 'completed') {
            addLog('[SUCCESS] Job completed while you were away!', 'success');
            setProgress(100);
            localStorage.removeItem('aws_solver_run_id');
            localStorage.removeItem('aws_solver_start_time');
            setIsRunning(false);
            setSolverState('finished');
            if (pollingTimerRef.current) {
              clearTimeout(pollingTimerRef.current);
              pollingTimerRef.current = null;
            }
          } else if (status.status === 'failed' || status.status === 'error') {
            addLog(`[ERROR] Job failed: ${status.error}`, 'error');
            localStorage.removeItem('aws_solver_run_id');
            localStorage.removeItem('aws_solver_start_time');
            setIsRunning(false);
            setSolverState('error');
            if (pollingTimerRef.current) {
              clearTimeout(pollingTimerRef.current);
              pollingTimerRef.current = null;
            }
          } else {
            // Still running - continue polling
            if (status.progress !== undefined) {
              setProgress(status.progress);
              // Log progress updates
              if (status.message) {
                addLog(`${Math.round(status.progress)}% - ${status.message}`, 'info');
              }
            }
            pollingTimerRef.current = setTimeout(resumePolling, 10000); // Poll every 10s
          }
        } else {
          addLog('[WARN] Could not check job status - job may have completed', 'warning');
          localStorage.removeItem('aws_solver_run_id');
          localStorage.removeItem('aws_solver_start_time');
          setIsRunning(false);
          setSolverState('ready');
          if (pollingTimerRef.current) {
            clearTimeout(pollingTimerRef.current);
            pollingTimerRef.current = null;
          }
        }
      } catch (error) {
        addLog(`[ERROR] Failed to resume polling: ${error}`, 'error');
        console.error('Resume polling error:', error);
      }
    };
    
    resumePolling();
    
    // Cleanup on unmount
    return () => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [addLog, isRunning]); // Run when addLog is ready OR when isRunning changes

  // Handle visibility changes (e.g., returning to browser tab or app)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return; // Page hidden, do nothing
      
      // Page became visible - check if we need to resume polling
      const savedRunId = localStorage.getItem('aws_solver_run_id');
      if (!savedRunId) return; // No active job
      
      const savedStartTime = localStorage.getItem('aws_solver_start_time');
      if (!savedStartTime) return;
      
      const startTime = parseInt(savedStartTime, 10);
      const elapsed = Date.now() - startTime;
      const maxRunTime = 12 * 60 * 60 * 1000; // 12 HOURS
      
      if (elapsed >= maxRunTime) return; // Job expired
      
      // If polling timer is active, no need to restart
      if (pollingTimerRef.current) return;
      
      // Otherwise, restart polling by triggering auto-resume
      addLog('🔄 Page became visible - resuming polling...', 'info');
      setIsRunning(true);
      setSolverState('running');
      
      // Restart polling with same logic as auto-resume
      const resumePolling = async () => {
        try {
          const AWS_SOLVER_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
          if (!AWS_SOLVER_URL) return;
          
          const statusResponse = await fetch(`${AWS_SOLVER_URL}/status/${savedRunId}`);
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            
            if (status.status === 'completed') {
              addLog('[SUCCESS] Job completed!', 'success');
              setProgress(100);
              localStorage.removeItem('aws_solver_run_id');
              localStorage.removeItem('aws_solver_start_time');
              setIsRunning(false);
              setSolverState('finished');
              if (pollingTimerRef.current) {
                clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
              }
            } else if (status.status === 'failed' || status.status === 'error') {
              addLog(`[ERROR] Job failed: ${status.error}`, 'error');
              localStorage.removeItem('aws_solver_run_id');
              localStorage.removeItem('aws_solver_start_time');
              setIsRunning(false);
              setSolverState('error');
              if (pollingTimerRef.current) {
                clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
              }
            } else {
              if (status.progress !== undefined) {
                setProgress(status.progress);
                if (status.message) {
                  addLog(`${Math.round(status.progress)}% - ${status.message}`, 'info');
                }
              }
              pollingTimerRef.current = setTimeout(resumePolling, 10000);
            }
          }
        } catch (error) {
          console.error('Visibility change polling error:', error);
          pollingTimerRef.current = setTimeout(resumePolling, 10000);
        }
      };
      
      resumePolling();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [addLog]);

  // WebSocket and polling functions removed for serverless approach
  
  const getSolverIcon = () => {
    switch (solverState) {
      case 'ready':
        return <IoPowerSharp className="w-6 h-6 text-white" />;
      case 'connecting':
        return <IoCloudSharp className="w-6 h-6 text-white animate-pulse" />;
      case 'running':
        return <IoSync className="w-6 h-6 text-white animate-spin" />;
      case 'finished':
        return <IoCheckmarkDoneSharp className="w-6 h-6 text-white" />;
      case 'error':
        return <IoWarningSharp className="w-6 h-6 text-white" />;
      default:
        return <IoPowerSharp className="w-6 h-6 text-white" />;
    }
  };

  const getSolverText = () => {
    switch (solverState) {
      case 'ready':
        return 'Ready';
      case 'connecting':
        return 'Connecting...';
      case 'running':
        return 'Processing';
      case 'finished':
        return 'Finished';
      case 'error':
        return 'Error';
      default:
        return 'Ready';
    }
  };

  // Auto-start local server if files exist but server not running
  const startLocalServer = useCallback(async () => {
    addLog('STATUS: Attempting to activate local server...', 'info');
    
    // Method 1: Try to wake up server with health check requests
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        addLog(`STATUS: Activation attempt ${attempt}/3...`, 'info');
        
        const response = await fetch('http://localhost:8000/health', {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          addLog('SUCCESS: Local server is now active!', 'success');
          setLocalSolverAvailable(true);
          // Refresh the installation status to reflect server is running
          setTimeout(checkInstallationStatus, 1000);
          // Refresh the page after successful detection
          setTimeout(() => {
            addLog('STATUS: Refreshing page to update interface...', 'success');
            window.location.reload();
          }, 2000);
          return true;
        }
      } catch {
        // Wait between attempts
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    // Method 2: Try to trigger server via service worker or background script
    try {
      addLog('INFO: Trying alternative activation method...', 'info');
      
      // Create a temporary iframe to try to load a local file that might trigger the server
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'http://localhost:8000/';
      document.body.appendChild(iframe);
      
      // Wait a moment then check again
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const healthResponse = await fetch('http://localhost:8000/health', {
        signal: AbortSignal.timeout(3000)
      });
      
      document.body.removeChild(iframe);
      
      if (healthResponse.ok) {
        addLog('SUCCESS: Local server activated successfully!', 'success');
        setLocalSolverAvailable(true);
        setTimeout(checkInstallationStatus, 1000);
        // Refresh the page after successful detection
        setTimeout(() => {
          addLog('STATUS: Refreshing page to update interface...', 'success');
          window.location.reload();
        }, 2000);
        return true;
      }
    } catch {
      // Clean up iframe if it exists
      const iframe = document.querySelector('iframe[src="http://localhost:8000/"]');
      if (iframe) {
        document.body.removeChild(iframe);
      }
    }

  addLog('[WARN] Could not auto-activate local server', 'warning');
  addLog('[TIP] Please run the start script manually: start_local_solver.bat (Windows) or ./start_local_solver.sh (Mac/Linux)', 'info');
  addLog('[FILE] Files are downloaded and ready in your Downloads folder', 'info');
    
    return false;
  }, [addLog, checkInstallationStatus]);

  // Modified handleRunSolver to auto-start local server when needed
  // Check whether an output name already exists either locally or serverless
  const checkNameConflict = async (name: string) => {
    if (!name) return false;
    try {
      // Check local FastAPI folders if available
      if (localSolverAvailable) {
        const resp = await fetch('http://localhost:8000/results/folders');
        if (resp.ok) {
          const data = await resp.json();
    if ((data.folders || []).some((f: { name: string }) => f.name === name)) return true;
        }
      }

      // Check serverless persisted folders
      const resp2 = await fetch(`/api/list/result-folders`);
      if (resp2.ok) {
        const data2 = await resp2.json();
  if ((data2.folders || []).some((f: { name: string }) => f.name === name)) return true;
      }
    } catch (err) {
      console.warn('Name conflict check failed:', err);
    }
    return false;
  };

  const handleRunSolver = async (solverMode: 'auto' | 'local' | 'serverless' | 'aws' = 'auto') => {
    if (isRunning) return;
    let actualSolver = 'unknown';
    
    if (!schedulingCase.shifts?.length) {
      addLog('No shifts available to optimize', 'error');
      return;
    }

    if (!schedulingCase.providers?.length) {
      addLog('No providers available for assignment', 'error');
      return;
    }

    // Require that user has applied the month selection (use Run Settings -> Apply)
    if (!isMonthSelectionLocked) {
      addLog('[ERROR] Please select the Month for Script and click "Apply" before running optimization', 'error');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setSolverState('connecting');

    // Start progress simulation for better UX
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return 95; // Cap at 95% until completion
        return prev + 1;
      });
    }, 3000); // Update every 3 seconds

    // Pre-flight: check requested output folder name for conflicts
    const requestedName = schedulingCase.run?.out || '';
    if (requestedName) {
      const conflict = await checkNameConflict(requestedName);
      if (conflict) {
        addLog(`[ERROR] Output folder name '${requestedName}' already exists. Please choose a different name.`, 'error');
        setIsRunning(false);
        return;
      }
    }
    
    // Determine which solver to use
    let shouldTryLocal = false;
    let shouldTryServerless = true;
    let shouldTryAWS = false;
    
    switch (solverMode) {
      case 'local':
        shouldTryLocal = true;
        shouldTryServerless = false;
        shouldTryAWS = false;
        addLog('[RUN] Starting LOCAL high-performance optimization...', 'info');
        break;
      case 'aws':
        shouldTryLocal = false;
        shouldTryServerless = false;
        shouldTryAWS = true;
        addLog('[RUN] Starting AWS CLOUD optimization...', 'info');
        break;
      case 'serverless':
        shouldTryLocal = false;
        shouldTryServerless = true;
        shouldTryAWS = false;
        addLog('[RUN] Starting SERVERLESS optimization...', 'info');
        break;
      case 'auto':
      default:
        shouldTryLocal = localSolverAvailable === true;
        shouldTryServerless = true;
        shouldTryAWS = false;
        addLog('[RUN] Starting optimization (auto-detect mode)...', 'info');
        break;
    }
    
  // Build payload that will be sent to the solver. If the user applied a Month selection,
  // restrict calendar.days and shifts to that month and trim any provider date-based fields
  const buildCasePayload = (): SchedulingCase => {
    // Start with a copy of the current scheduling case
    let payload: SchedulingCase = { ...schedulingCase };

    try {
      if (isMonthSelectionLocked && appliedMonth !== null && appliedYear !== null) {
        const { start, end, days } = getMonthRange(appliedYear, appliedMonth);
        const inMonth = (d: string) => typeof d === 'string' && d >= start && d <= end;

        const filteredShifts = (schedulingCase.shifts || [])
          .filter(s => typeof s.date === 'string' && inMonth(s.date))
          .map(shift => {
            if (shift.start && shift.end) {
              try {
                const startDate = new Date(shift.start);
                const endDate = new Date(shift.end);

                if (endDate <= startDate) {
                  const correctedEndDate = new Date(endDate);
                  correctedEndDate.setDate(correctedEndDate.getDate() + 1);
                  addLog(`[INFO] Correcting overnight shift '${shift.id}' to end on the next day.`, 'info');
                  const pad = (num: number) => num.toString().padStart(2, '0');
                  const formatToLocalISO = (date: Date) => 
                    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
                    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
                  return { ...shift, start: formatToLocalISO(startDate), end: formatToLocalISO(correctedEndDate) };
                }
              } catch (e) {
                return shift;
              }
            }
            return shift;
          });

        const trimmedProviders = (schedulingCase.providers || []).map((p) => {
          const np: Provider = { ...p } as Provider;
          if (Array.isArray(p.forbidden_days_hard)) np.forbidden_days_hard = p.forbidden_days_hard.filter(d => typeof d === 'string' && inMonth(d));
          if (Array.isArray(p.forbidden_days_soft)) np.forbidden_days_soft = p.forbidden_days_soft.filter(d => typeof d === 'string' && inMonth(d));
          if (p.preferred_days_hard && typeof p.preferred_days_hard === 'object') {
            const map: Record<string, string[]> = {};
            Object.entries(p.preferred_days_hard).forEach(([dateKey, shiftTypes]) => {
              if (inMonth(dateKey)) { map[dateKey] = shiftTypes; }
            });
            np.preferred_days_hard = map;
          }
          if (p.preferred_days_soft && typeof p.preferred_days_soft === 'object') {
            const map: Record<string, string[]> = {};
            Object.entries(p.preferred_days_soft).forEach(([dateKey, shiftTypes]) => {
              if (inMonth(dateKey)) { map[dateKey] = shiftTypes; }
            });
            np.preferred_days_soft = map;
          }
          return np;
        });

        // Update the payload with the month-filtered data
        payload = {
          ...schedulingCase,
          calendar: { ...schedulingCase.calendar, days },
          shifts: filteredShifts,
          providers: trimmedProviders,
        };
      }
    } catch (err) {
      console.warn('Failed to build month-limited payload, falling back to full case:', err);
      // Ensure payload is a fresh copy if filtering fails
      payload = { ...schedulingCase };
    }

    // --- CHANGE ---
    // Force every provider's type to "MD" and their type_ranges to use "MD" as the key.
    // payload.providers = (payload.providers || []).map(provider => ({
    //   ...provider,
    //   type: 'MD', // Force the main type
    //   limits: {
    //     ...provider.limits, // Keep existing min/max totals
    //     type_ranges: {
    //       "MD": [0, 50] // Force the type_ranges key to "MD"
    //     }
    //   }
    // }));
    
    addLog(`[INFO] Processing ${payload.shifts.length} shifts and ${payload.providers.length} providers (dataset sent to solver)`, 'info');

    return payload;
  };

  const payload = buildCasePayload();
 // addLog(`[INFO] Processing ${payload.shifts.length} shifts and ${payload.providers.length} providers (dataset sent to solver)`, 'info');

    try {
      const startTime = Date.now();
      let result: SolverResult | null = null;
      
      // Try local solver first if requested
      if (shouldTryLocal) {
        setSolverState('running');
            addLog('[CONNECT] Connecting to local solver...', 'info');
            addLog('[INFO] Complex optimizations may take several hours - please be patient...', 'info');
        
        try {
                const localResponse = await fetch('http://localhost:8000/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000000), // 4 hour timeout for complex optimizations
          });
          
          if (localResponse.ok) {
            const initialResult = await localResponse.json();
            
            // Check if local solver returns a run_id for async processing
            if (initialResult.run_id && initialResult.status === 'processing') {
              addLog('[INFO] Local solver started - tracking progress...', 'info');
              
              // Poll for status updates
              let pollingAttempts = 0;
              const maxPollingAttempts = 7200; // 4 hours at 2-second intervals
              
              while (pollingAttempts < maxPollingAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds
                
                try {
                  const statusResponse = await fetch(`http://localhost:8000/status/${initialResult.run_id}`, {
                    signal: AbortSignal.timeout(5000),
                  });
                  
                  if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    
                    // Update progress if available
                    if (statusData.progress !== undefined) {
                      setProgress(Math.min(statusData.progress, 95));
                      addLog(`[PROGRESS] ${Math.round(statusData.progress)}% complete`, 'info');
                    }
                    
                    // Check if completed
                    if (statusData.status === 'completed') {
                      result = statusData;
                      addLog('[SUCCESS] Using LOCAL high-performance solver', 'success');
                      actualSolver = 'local';
                      break;
                    }
                    
                    // Check if failed
                    if (statusData.status === 'failed' || statusData.status === 'error') {
                      throw new Error(statusData.message || 'Local solver failed');
                    }
                  }
                } catch (pollError) {
                  console.warn('Status poll failed:', pollError);
                  // Continue polling despite individual failures
                }
                
                pollingAttempts++;
              }
              
              if (!result) {
                throw new Error('Local solver timed out');
              }
            } else {
              // Synchronous response (old behavior)
              result = initialResult;
              addLog('[SUCCESS] Using LOCAL high-performance solver', 'success');
              actualSolver = 'local';
            }
          } else {
            throw new Error(`Local solver returned ${localResponse.status}`);
          }
          } catch (localError) {
          const errorMsg = localError instanceof Error ? localError.message : 'Unknown error';
          addLog(`[WARN] Local solver not responding: ${errorMsg}`, 'warning');
          
          // Try to auto-start the local server if files are available
          if (installationStatus.filesInstalled) {
            addLog('[ACTION] Attempting to start local server automatically...', 'info');
            const serverStarted = await startLocalServer();
            
            if (serverStarted) {
              // Retry the local solver request
              try {
                const retryResponse = await fetch('http://localhost:8000/solve', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                  signal: AbortSignal.timeout(20000000), // 4 hour timeout for retry
                });
                
                if (retryResponse.ok) {
                  result = await retryResponse.json();
                  addLog('[SUCCESS] Using LOCAL high-performance solver (auto-started)', 'success');
                  
                  if (result && result.statistics) {
                    result.statistics.actualSolverUsed = 'local';
                  }
                }
              } catch {
                addLog('[ERROR] Retry after auto-start failed', 'error');
              }
            }
          }
          
          if (!result && !shouldTryServerless) {
            throw new Error(`Local solver required but failed: ${errorMsg}`);
          }
          
          addLog('[WARN] Falling back to serverless solver...', 'warning');
        }
      }
      
      // Try AWS cloud solver if requested
      if (!result && shouldTryAWS) {
        addLog('[CONNECT] Connecting to AWS cloud solver...', 'info');
        
        // Clear the generic progress interval for AWS - we'll use real progress
        clearInterval(progressInterval);
        setProgress(0);
        
        // Generate a unique run ID for log streaming
        const currentRunId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        setRunId(currentRunId);
        
        const AWS_SOLVER_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
        
        if (!AWS_SOLVER_URL) {
          addLog('[ERROR] AWS solver URL not configured. Please set NEXT_PUBLIC_AWS_SOLVER_URL environment variable.', 'error');
          throw new Error('AWS solver URL not configured');
        }
        
        try {
          // Use our Next.js API route that properly handles AWS
          const awsResponse = await fetch('/api/aws-solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(600000), // 10 minute timeout
          });

          if (awsResponse.ok) {
            const awsResult = await awsResponse.json();
            
            // Check if AWS returned async response (with run_id and status)
            if (awsResult.run_id && (awsResult.status === 'processing' || awsResult.status === 'accepted')) {
              // Save run_id to localStorage so we can resume after refresh
              localStorage.setItem('aws_solver_run_id', awsResult.run_id);
              localStorage.setItem('aws_solver_start_time', Date.now().toString());
              
              addLog('[INFO] AWS optimization started, polling for progress...', 'info');
              addLog(`[INFO] Job ID: ${awsResult.run_id} (persisted - safe to refresh)`, 'info');
              setSolverState('running');
              
              // Clear any existing polling timer
              if (pollingTimerRef.current) {
                clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
              }
              
              // Poll for status updates with real progress
              let lastProgress = 0;
              
              const pollAwsStatus = async () => {
                try {
                  const statusResponse = await fetch(`${AWS_SOLVER_URL}/status/${awsResult.run_id}`);
                  if (statusResponse.ok) {
                    const status = await statusResponse.json();
                    
                    // Update progress with real data from AWS
                    if (status.progress !== undefined && status.progress !== lastProgress) {
                      lastProgress = status.progress;
                      setProgress(Math.min(status.progress, 95));
                      addLog(`${Math.round(status.progress)}% - ${status.message || 'Processing...'}`, 'info');
                    }
                    
                    // Log any status messages
                    if (status.current_state && status.current_state !== 'running') {
                      addLog(`[AWS] State: ${status.current_state}`, 'info');
                    }
                    
                    // Check if completed
                    if (status.status === 'completed') {
                      if (pollingTimerRef.current) {
                        clearTimeout(pollingTimerRef.current);
                        pollingTimerRef.current = null;
                      }
                      result = status;
                      addLog('[SUCCESS] AWS optimization completed', 'success');
                      // Clear saved job from localStorage
                      localStorage.removeItem('aws_solver_run_id');
                      localStorage.removeItem('aws_solver_start_time');
                    } else if (status.status === 'failed' || status.status === 'error') {
                      if (pollingTimerRef.current) {
                        clearTimeout(pollingTimerRef.current);
                        pollingTimerRef.current = null;
                      }
                      // Clear saved job from localStorage
                      localStorage.removeItem('aws_solver_run_id');
                      localStorage.removeItem('aws_solver_start_time');
                      throw new Error(status.error || 'AWS optimization failed');
                    } else {
                      // Continue polling
                      pollingTimerRef.current = setTimeout(pollAwsStatus, 10000);
                    }
                  }
                } catch (pollError) {
                  console.error('Status polling error:', pollError);
                  // Continue polling on temporary errors
                  pollingTimerRef.current = setTimeout(pollAwsStatus, 10000);
                }
              };
              
              // Start polling
              pollAwsStatus();
              
              // Wait for result (NO TIMEOUT - solver can run for hours)
              // Job will be saved to localStorage and can be resumed after page refresh
              // The 12-hour safety limit in useEffect handles extreme cases
              while (!result) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              
              if (pollingTimerRef.current) {
                clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
              }
            } else if (awsResult.status === 'queued' || awsResult.status === 'processing') {
              // Async response - job queued, poll for status
              addLog(`[INFO] Job queued: ${awsResult.run_id}. Polling for status...`, 'info');
              
              // Clear any existing polling timer
              if (pollingTimerRef.current) {
                clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
              }
              
              // Poll status endpoint
              const pollQueuedStatus = async () => {
                try {
                  const statusResp = await fetch(`${AWS_SOLVER_URL}/status/${awsResult.run_id}`);
                  if (statusResp.ok) {
                    const statusData = await statusResp.json();
                    if (statusData.progress !== undefined) {
                      setProgress(statusData.progress);
                      addLog(`${Math.round(statusData.progress)}% - ${statusData.message || 'Processing...'}`, 'info');
                    }
                    if (statusData.status === 'completed') {
                      if (pollingTimerRef.current) {
                        clearTimeout(pollingTimerRef.current);
                        pollingTimerRef.current = null;
                      }
                      result = statusData;
                      setProgress(100);
                    } else {
                      // Continue polling
                      pollingTimerRef.current = setTimeout(pollQueuedStatus, 10000);
                    }
                  } else {
                    console.error('Status response not ok:', statusResp.status);
                    pollingTimerRef.current = setTimeout(pollQueuedStatus, 10000);
                  }
                } catch (e) {
                  console.error('Status poll error:', e);
                  addLog(`[DEBUG] Polling error: ${e}`, 'warning');
                  pollingTimerRef.current = setTimeout(pollQueuedStatus, 10000);
                }
              };
              
              // Start polling
              pollQueuedStatus();
              
              // Wait for completion (NO TIMEOUT - solver can run for hours)
              // Job will be saved to localStorage and can be resumed after page refresh
              // The 12-hour safety limit in useEffect handles extreme cases
              while (!result) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              
              if (pollingTimerRef.current) {
                clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
              }
            } else if (awsResult.status === 'completed' || awsResult.results) {
              // Synchronous response - AWS completed immediately
              result = awsResult;
              setProgress(100);
            } else {
              throw new Error(`AWS returned unexpected response format: ${JSON.stringify(awsResult).substring(0, 200)}`);
            }
            
            addLog('[SUCCESS] Using AWS CLOUD solver', 'success');
            actualSolver = 'aws';
          } else {
            const errorData = await awsResponse.json().catch(() => ({}));
            throw new Error(errorData.message || `AWS solver returned ${awsResponse.status}`);
          }
        } catch (awsError) {
          const errorMsg = awsError instanceof Error ? awsError.message : 'Unknown error';
          addLog(`[ERROR] AWS cloud solver failed: ${errorMsg}`, 'error');
          
          if (!shouldTryServerless) {
            throw new Error(`AWS solver required but failed: ${errorMsg}`);
          }
          
          addLog('[WARN] Falling back to serverless solver...', 'warning');
        }
      }
      
      // Try serverless if local/AWS failed or not requested
      if (!result && shouldTryServerless) {
        addLog('[CONNECT] Connecting to serverless solver...', 'info');
        
        const serverlessResponse = await fetch('/api/solve?mode=serverless', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!serverlessResponse.ok) {
          const errorData = await serverlessResponse.json();
          throw new Error(errorData.message || `HTTP ${serverlessResponse.status}`);
        }

        result = await serverlessResponse.json();
        addLog('[SUCCESS] Using SERVERLESS solver', 'success');
        actualSolver = 'serverless';
      }
      
      if (!result) {
        throw new Error('No solver available');
      }

      const executionTime = Date.now() - startTime;
      addLog(`[SUCCESS] Optimization completed in ${executionTime}ms using ${actualSolver.toUpperCase()} solver`, 'success');
      
      // Clear progress interval and set to 100%
      clearInterval(progressInterval);
      setProgress(100);
      
      if (result.status === 'completed') {
        setSolverState('finished');
        
        // Display results
        if (result.results && typeof result.results === 'object') {
          const resultsData = result.results as { solutions?: Array<unknown>; solver_stats?: Record<string, unknown> };
          const solutions = resultsData.solutions || [];
          const stats = resultsData.solver_stats || {};
          
          addLog(`[OK] Generated ${solutions.length} solution(s)`, 'success');
          addLog(`[SOLVER] Solver: ${stats.solver_type || 'serverless'} (${stats.status || 'completed'})`, 'info');
          
          let finalOutputDirectory = result.output_directory;

          // If local solver was used, upload the packaged results to Vercel Blob
          if (actualSolver === 'local' && result.packaged_files) {
            addLog('[INFO] Uploading local solver results to persistent storage...', 'info');
            try {
              const uploadResponse = await fetch('/api/upload-packaged-results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packaged_files: result.packaged_files }),
              });

              if (uploadResponse.ok) {
                const uploadResult = await uploadResponse.json();
                finalOutputDirectory = uploadResult.folderName;
                addLog(`[SUCCESS] Successfully stored local results in: ${finalOutputDirectory}`, 'success');
              } else {
                const errorData = await uploadResponse.json();
                throw new Error(errorData.error || 'Failed to upload local results');
              }
            } catch (uploadError) {
              addLog(`[ERROR] Failed to upload local results to Vercel Blob: ${uploadError}`, 'error');
            }
          } else {
             // Generate a result folder name for serverless run
            const generatedName = generateResultFolderName();
            finalOutputDirectory = finalOutputDirectory || generatedName;
          }

          // Store last run results for output folder functionality
          const runResultsPayload = {
            run_id: result.run_id || `serverless_${Date.now()}`,
            output_directory: finalOutputDirectory || generateResultFolderName(),
            timestamp: new Date().toISOString(),
            solver_type: actualSolver,
            results: result.results,
            // Include a snapshot of the scheduling case used to generate these results
            caseSnapshot: schedulingCase,
            statistics: result.statistics
          };
                    
          dispatch({
            type: 'SET_RESULTS',
            payload: runResultsPayload
          });
          
          // Also populate scheduling results context for calendar display
          if (result.results && typeof result.results === 'object') {
            try {
              const resultData = result.results as { solutions?: Array<{ assignments?: Array<{ 
                date: string; 
                shift_id: string; 
                shift_type: string; 
                provider_id: string; 
                provider_name: string; 
                start_time: string; 
                end_time: string; 
              }> }> };
              
              if (resultData.solutions && resultData.solutions.length > 0 && resultData.solutions[0].assignments) {
                const assignments = resultData.solutions[0].assignments.map(assignment => ({
                  date: assignment.date,
                  shiftId: assignment.shift_id || assignment.shift_id || 'unknown',
                  shiftType: assignment.shift_type,
                  providerId: assignment.provider_id,
                  providerName: assignment.provider_name,
                  startTime: assignment.start_time,
                  endTime: assignment.end_time
                }));

                setSchedulingResults({
                  assignments,
                  runId: runResultsPayload.run_id,
                  timestamp: runResultsPayload.timestamp,
                  solverType: actualSolver as 'local' | 'serverless',
                  summary: {
                    totalAssignments: assignments.length,
                    totalProviders: new Set(assignments.map(a => a.providerId)).size,
                    totalShifts: assignments.length
                  }
                });
                
                addLog(`[INFO] Calendar data updated with ${assignments.length} scheduling assignments`, 'success');
              }
              } catch {
              addLog('[WARN] Could not parse scheduling results for calendar display', 'warning');
            }
          }
          
          // Store results in context (note: this may need proper action type in context)
          // dispatch({
          //   type: 'SET_RESULTS',
          //   payload: {
          //     results: result.results,
          //     metadata: {
          //       runId: result.run_id || 'serverless',
          //       timestamp: new Date().toISOString(),
          //       statistics: result.statistics,
          //       executionTimeMs: executionTime,
          //       solverType: 'serverless'
          //     }
          //   }
          // });
          
          // For now, just log the results
          addLog(`[INFO] Results: ${JSON.stringify(result.results, null, 2).slice(0, 200)}...`, 'info');
          
          addLog('[INFO] Results saved and ready for export', 'success');
        }

        setIsRunning(false);

      } else if (result.status === 'error') {
        throw new Error(result.error || result.message);
      }
      
    } 
    catch (error: unknown) {
    // Clear progress interval on error
    clearInterval(progressInterval);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    addLog(`[ERROR] Optimization failed: ${errorMessage}`, 'error');
    setSolverState('error');
    setProgress(0);
} finally {
    // Ensure progress interval is always cleared
    clearInterval(progressInterval);
    
    setIsRunning(false);
    setSolverState((currentState) => {
        // If the state is still 'running' when the function is done,
        // it means the success path didn't update it. Force it to 'finished'.
        if (currentState === 'running' || currentState === 'connecting') {
            return 'finished';
        }
        // Otherwise, it was already correctly set to 'finished' or 'error'.
        return currentState;
    });
}
  };

  const stopSolver = async () => {
    // STOP PROCESS: Actually terminate the ECS task running the solver
    // This will kill the solver job on AWS (not just stop tracking)
    
    const confirmStop = confirm(
      '⚠️ Are you sure you want to STOP the solver process?\n\n' +
      'This will terminate the running job on AWS.\n' +
      'The solver will stop computing and no results will be saved.\n\n' +
      'Click OK to stop, or Cancel to continue running.'
    );
    
    if (!confirmStop) {
      addLog('[INFO] Stop cancelled - solver continues running', 'info');
      return;
    }
    
    addLog('[INFO] 🛑 Stopping solver process on AWS...', 'warning');
    
    try {
      const savedRunId = localStorage.getItem('aws_solver_run_id');
      if (!savedRunId) {
        addLog('[WARNING] No active job found in storage', 'warning');
        addLog('[INFO] Resetting UI state...', 'info');
        
        // Reset everything since there's no job to stop
        localStorage.removeItem('aws_solver_run_id');
        localStorage.removeItem('aws_solver_start_time');
        localStorage.removeItem('solver-running');
        localStorage.removeItem('solver-state');
        localStorage.removeItem('solver-progress');
        
        // Clear polling timer if any
        if (pollingTimerRef.current) {
          clearTimeout(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
        
        setIsRunning(false);
        setSolverState('ready');
        setProgress(0);
        
        addLog('[SUCCESS] UI state reset successfully', 'success');
        return;
      }
      
      // Call API to stop the ECS task
      const response = await fetch(`${process.env.NEXT_PUBLIC_AWS_SOLVER_URL}/stop/${savedRunId}`, {
        method: 'POST'
      });
      
      if (response.ok) {
        addLog('[SUCCESS] Solver process stopped successfully', 'success');
        addLog('[INFO] The ECS task has been terminated', 'info');
        
        // Clear tracking
        localStorage.removeItem('aws_solver_run_id');
        localStorage.removeItem('aws_solver_start_time');
        localStorage.removeItem('solver-running');
        localStorage.removeItem('solver-state');
        localStorage.removeItem('solver-progress');
        
        // Clear polling timer
        if (pollingTimerRef.current) {
          clearTimeout(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
        
        setIsRunning(false);
        setSolverState('ready');
        setProgress(0);
      } else {
        const errorData = await response.json().catch(() => ({}));
        
        // If job not found on AWS, still reset the UI
        if (response.status === 404 || errorData.status === 'not_found') {
          addLog('[WARNING] Job not found on AWS (may have already completed)', 'warning');
          addLog('[INFO] Resetting UI state...', 'info');
          
          localStorage.removeItem('aws_solver_run_id');
          localStorage.removeItem('aws_solver_start_time');
          localStorage.removeItem('solver-running');
          localStorage.removeItem('solver-state');
          localStorage.removeItem('solver-progress');
          
          if (pollingTimerRef.current) {
            clearTimeout(pollingTimerRef.current);
            pollingTimerRef.current = null;
          }
          
          setIsRunning(false);
          setSolverState('ready');
          setProgress(0);
          
          addLog('[SUCCESS] UI state reset successfully', 'success');
        } else {
          addLog('[ERROR] Failed to stop solver process', 'error');
          addLog('[INFO] You can manually stop the ECS task from AWS Console', 'warning');
        }
      }
    } catch (error) {
      addLog(`[ERROR] Failed to stop solver: ${error}`, 'error');
      addLog('[WARNING] Resetting UI state anyway...', 'warning');
      
      // Reset UI even on error
      localStorage.removeItem('aws_solver_run_id');
      localStorage.removeItem('aws_solver_start_time');
      localStorage.removeItem('solver-running');
      localStorage.removeItem('solver-state');
      localStorage.removeItem('solver-progress');
      
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      
      setIsRunning(false);
      setSolverState('ready');
      setProgress(0);
    }
  };


  const handleExportLatestSchedule = async () => {
    addLog('[INFO] Exporting latest schedule...', 'info');
    try {
      addLog('[INFO] Getting available result folders for export...', 'info');
      const folders = await getAvailableResultFolders();
      addLog(`[INFO] Found ${folders.length} folders for export.`, 'info');

      if (folders.length === 0) {
        addLog('[WARN] No result folders found to export from', 'warning');
        return;
      }
      const latestFolder = folders[0]; // Folders are sorted descending by name
      addLog(`[INFO] Identified latest result folder for export: ${latestFolder.name}`, 'info');

      const fileName = 'calendar.xlsx';
      const downloadUrl = `/api/download/result-folder?name=${encodeURIComponent(latestFolder.name)}&file=${encodeURIComponent(fileName)}`;
      addLog(`[INFO] Constructed download URL for export: ${downloadUrl}`, 'info');

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      addLog(`[DOWNLOADED] Started download for: ${fileName} from ${latestFolder.name}`, 'success');

    } catch (error) {
      addLog(`[ERROR] Failed to export latest schedule: ${error}`, 'error');
    }
  };

  const handleOpenOutputFolder = async () => {
    if (!lastResults) {
  addLog(`[WARN] No recent results available. Current output folder setting: ${schedulingCase.run.out}`, 'warning');
  addLog('[TIP] Run optimization first to generate results that can be viewed', 'info');
      return;
    }

    const { run_id, output_directory, timestamp, solver_type } = lastResults;
    
    try {
  addLog(`[INFO] Opening results for run: ${run_id}`, 'info');
  addLog(`[INFO] Generated: ${new Date(timestamp).toLocaleString()}`, 'info');
  addLog(`[INFO] Solver: ${solver_type}`, 'info');
      
  // Load available files and show download menu
  await loadAvailableFiles();
      
      if (solver_type === 'local' && localSolverAvailable) {
        // For local solver, get detailed output directory contents
        try {
          const response = await fetch(`http://localhost:8000/output/${run_id}`);
          if (response.ok) {
            const outputInfo = await response.json();
            addLog(`[FILE] Output directory: ${outputInfo.output_directory}`, 'success');
            
            // Display files with details and timestamps
            if (outputInfo.files && outputInfo.files.length > 0) {
              addLog('[INFO] Generated files:', 'info');
              
              // Sort files by modification time (newest first)
              const sortedFiles = outputInfo.files.sort((a: { name: string; size: number; modified: string }, b: { name: string; size: number; modified: string }) => 
                new Date(b.modified).getTime() - new Date(a.modified).getTime()
              );
              
              sortedFiles.forEach((file: { name: string; size: number; modified: string }, index: number) => {
                const sizeKB = Math.round(file.size / 1024);
                const modifiedDate = new Date(file.modified).toLocaleString();
                const isNewest = index === 0;
                
                if (file.name.endsWith('.xlsx')) {
                  addLog(`   ${isNewest ? '[LATEST]' : '[EXCEL]'} ${file.name} - Excel schedule output (${sizeKB} KB, ${modifiedDate})`, 
                         isNewest ? 'success' : 'info');
                } else if (file.name.endsWith('.json')) {
                  addLog(`   ${isNewest ? '[LATEST]' : '[JSON]'} ${file.name} - Configuration/Results data (${sizeKB} KB, ${modifiedDate})`, 
                         isNewest ? 'success' : 'info');
                } else {
                  addLog(`   ${isNewest ? '[LATEST]' : '[FILE]'} ${file.name} (${sizeKB} KB, ${modifiedDate})`, 
                         isNewest ? 'success' : 'info');
                }
              });
              
              // Highlight the newest Excel file
              const excelFiles = sortedFiles.filter((f: { name: string; size: number; modified: string }) => f.name.endsWith('.xlsx'));
              if (excelFiles.length > 0) {
                const newestExcel = excelFiles[0];
                addLog(`[LATEST] Latest Excel output: ${newestExcel.name} (Modified: ${new Date(newestExcel.modified).toLocaleString()})`, 'success');
                addLog('[TIP] This file contains the most recent schedule assignments and can be opened in Excel', 'info');
                addLog(`[LINK] Download link: http://localhost:8000/download/${run_id}/${newestExcel.name}`, 'info');
              }
            } else {
              addLog('[INFO] Contains input_case.json and results.json', 'info');
            }
            
            // For Windows, try to open the folder in explorer
            if (navigator.platform.includes('Win')) {
              addLog('[TIP] On Windows: Open File Explorer and navigate to the solver_output folder in your project directory', 'info');
            }
          } else {
            addLog(`[FILE] Output directory: ${output_directory}`, 'success');
            addLog('[INFO] Contains input_case.json and results.json', 'info');
          }
        } catch {
          addLog(`[FILE] Output directory: ${output_directory}`, 'success');
          addLog('[TIP] Check your project folder > solver_output > [run_id] for generated files', 'info');
        }
      } else {
        // For serverless results, show export options
  addLog('[INFO] Serverless solver results are available in the export functions', 'success');
  addLog('[INFO] Use "Export Results" to download the generated schedule', 'info');
        
        // Auto-generate and display newest Excel export
    //     try {
    //       const { exportScheduleToExcel, generateMockResults } = await import('@/lib/excelExport');
    //       const mockResults = generateMockResults(schedulingCase);
    //       const filename = exportScheduleToExcel(schedulingCase, mockResults, `Latest_Schedule_${new Date().toISOString().split('T')[0]}.xlsx`);
    //       addLog(`[DOWNLOADED] Generated latest Excel export: ${filename}`, 'success');
    //       addLog('[TIP] This file contains the newest schedule configuration and assignments', 'info');
    //     } catch {
    // addLog('[WARN] Could not auto-generate Excel export', 'warning');
    //     }
      }
      
      // Display summary of results if available
      if (lastResults.results && typeof lastResults.results === 'object') {
        const results = lastResults.results as {
          summary?: {
            total_assignments?: number;
            total_providers?: number;
            total_shifts?: number;
          };
          optimization_info?: {
            solver_runtime?: string;
            objective_value?: number;
          };
        };
        if (results.summary) {
          addLog('[INFO] Solution summary:', 'info');
          addLog(`   • Total assignments: ${results.summary.total_assignments || 'N/A'}`, 'info');
          addLog(`   • Providers used: ${results.summary.total_providers || 'N/A'}`, 'info');
          addLog(`   • Shifts covered: ${results.summary.total_shifts || 'N/A'}`, 'info');
        }
        
        if (results.optimization_info) {
          addLog('[INFO] Optimization info:', 'info');
          addLog(`   • Runtime: ${results.optimization_info.solver_runtime || 'N/A'}`, 'info');
          addLog(`   • Objective value: ${results.optimization_info.objective_value || 'N/A'}`, 'info');
        }
      }
      
  addLog('[TIP] Use the download buttons above to get individual files', 'info');
    } catch (error) {
      addLog(`[ERROR] Error viewing results: ${error}`, 'error');
    }
  };

  // Function to load available files for download
  const loadAvailableFiles = async () => {
    setLoadingFiles(true);
    try {
      // Instead of loading individual files, load result folders
      const folders = await getAvailableResultFolders();
      
      // Convert folders to the expected file format for the modal
      const folderData = folders.map((folder: { name: string; created?: number | string; fileCount: number }) => ({
        name: folder.name,
        size: folder.fileCount * 25600, // Estimate ~25KB per file
        modified: folder.created ? (typeof folder.created === 'number' ? new Date(folder.created * 1000).toLocaleString() : String(folder.created)) : 'Unknown',
        // Prefer serverless Next.js zipping endpoint for folder downloads so converted Result_N folders are available
        downloadUrl: `#folder-${folder.name}`,
        isFolder: true,
        fileCount: folder.fileCount
      }));
      
  setAvailableFiles(folderData);
  setShowFilesMenu(true);
  addLog(`[INFO] Found ${folders.length} result folder${folders.length !== 1 ? 's' : ''}`, 'success');
      
      if (folderData.length === 0) {
        addLog('[TIP] Run optimization to create your first Result_1 folder', 'info');
      }
    } catch (error) {
      addLog(`[ERROR] Error loading result folders: ${error}`, 'error');
    } finally {
      setLoadingFiles(false);
    }
  };

  // Function to download a specific file or folder
  const downloadFile = async (file: { name: string; downloadUrl: string; isFolder?: boolean }) => {
    try {
        if (file.downloadUrl.startsWith('#folder-')) {
        // Handle serverless folder download via Next.js API
        const folderName = file.downloadUrl.replace('#folder-', '');
  addLog(`[INFO] Requesting ZIP for ${folderName} from server...`, 'info');
        try {
          const resp = await fetch(`/api/download/result-folder?name=${encodeURIComponent(folderName)}`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `${folderName}.zip`;
          // Append to DOM to ensure click works in all browsers
          document.body.appendChild(a);
          a.click();
          // Clean up anchor and revoke URL shortly after to allow the browser to start the download
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          addLog(`[DOWNLOADED] Downloaded: ${folderName}.zip`, 'success');
        } catch (err) {
          addLog(`[ERROR] Failed to download ${folderName}: ${err}`, 'error');
        }
      } else if (file.downloadUrl.startsWith('#')) {
        // Handle special export cases
        if (file.downloadUrl === '#excel-export') {
          const { exportScheduleToExcel, generateMockResults } = await import('@/lib/excelExport');
          const mockResults = generateMockResults(schedulingCase);
          const filename = exportScheduleToExcel(schedulingCase, mockResults, file.name);
          addLog(`[DOWNLOADED] Downloaded: ${filename}`, 'success');
        } else if (file.downloadUrl === '#config-export') {
          const configData = JSON.stringify(schedulingCase, null, 2);
          const blob = new Blob([configData], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          addLog(`[DOWNLOADED] Downloaded: ${file.name}`, 'success');
        }
      } else {
        // Handle direct download URL (for local solver)
        if (file.isFolder) {
          addLog(`[INFO] Downloading folder: ${file.name} as ZIP...`, 'info');
        }
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = file.downloadUrl;
        a.download = file.isFolder ? `${file.name}.zip` : file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // If this was a folder download that relies on a streamed response, allow the browser a moment
        setTimeout(() => {
          addLog(`[DOWNLOADED] Downloaded: ${file.isFolder ? `${file.name}.zip` : file.name}`, 'success');
        }, 10);
      }
    } catch (error) {
      addLog(`[ERROR] Error downloading ${file.name}: ${error}`, 'error');
    }
  };

  const updateRunConfig = useCallback((field: keyof typeof schedulingCase.run, value: string | number) => {
    dispatch({
      type: 'UPDATE_CASE',
      payload: {
        run: {
          ...schedulingCase.run,
          [field]: value,
        },
      },
    });
  }, [dispatch, schedulingCase]);

  // Function to generate unique result folder name
  const generateResultFolderName = () => {
    // Be defensive when reading the counter: localStorage may contain a non-numeric
    // value (e.g. from older builds or accidental writes). Parse it safely.
    let existingResults = 0;
    try {
      const raw = localStorage.getItem('result-folder-counter');
      if (raw != null) {
        // Try to parse as an integer; if it fails, fallback to 0
        const parsed = parseInt(raw as string, 10);
        existingResults = Number.isFinite(parsed) ? parsed : 0;
      }
    } catch {
      existingResults = 0;
    }
    const nextNumber = existingResults + 1;
    // Store as a simple string to avoid JSON parsing issues in older entries
    localStorage.setItem('result-folder-counter', String(nextNumber));
    return `Result_${nextNumber}`;
  };

  // Compute next available Result_N by checking serverless persisted folders and local FastAPI folders
  const computeNextAvailableName = useCallback(async (): Promise<string> => {
    let maxNum = 0;
    try {
      // Check serverless persisted folders first
      const resp = await fetch('/api/list/result-folders');
      if (resp.ok) {
        const data = await resp.json();
        (data.folders || []).forEach((f: { name: string }) => {
          const m = f.name.match(/^Result_(\d+)$/i);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          }
        });
      }
    } catch {
      // ignore
    }

    try {
      // Check local FastAPI folders if available
      if (localSolverAvailable) {
        const resp2 = await fetch('http://localhost:8000/results/folders');
        if (resp2.ok) {
          const data2 = await resp2.json();
          (data2.folders || []).forEach((f: { name: string }) => {
            const m = f.name.match(/^Result_(\d+)$/i);
            if (m) {
              const n = parseInt(m[1], 10);
              if (!isNaN(n) && n > maxNum) maxNum = n;
            }
          });
        }
      }
    } catch {
      // ignore
    }

    const next = maxNum + 1;
    localStorage.setItem('result-folder-counter', JSON.stringify(next));
    return `Result_${next}`;
  }, [localSolverAvailable]);

  // Auto-fill Output Folder Name input with next available Result_N when the tab loads or local availability changes
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Compute the next Result_N but only update / log when it differs
        // from the currently stored value to avoid spamming the logs when
        // the component re-renders multiple times.
        const nextName = await computeNextAvailableName();
        if (!mounted) return;

        const currentOut = schedulingCase?.run?.out ?? '';
        if (currentOut !== nextName) {
          updateRunConfig('out', nextName);
          addLog(`Auto-filled Output Folder Name: ${nextName}`, 'info');
        }
      } catch {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, [localSolverAvailable, addLog, updateRunConfig, computeNextAvailableName, schedulingCase?.run?.out]);

  // Initialize month selector from current calendar when component mounts or schedulingCase changes
  useEffect(() => {
    try {
      const firstDay = schedulingCase?.calendar?.days?.[0];
      if (firstDay) {
        // Parse date string manually to avoid timezone issues
        const [year, month, day] = firstDay.split('-').map(Number);
        const dt = new Date(year, month - 1, day); // month is 1-based in string, 0-based in Date
        if (!isNaN(dt.getTime())) {
          const calendarMonth = dt.getMonth() + 1;
          const calendarYear = dt.getFullYear();
          
          setSelectedMonth(calendarMonth);
          setSelectedYear(calendarYear);
          
          // Only unlock if this is an external calendar change (not matching user's applied selection)
          if (appliedMonth !== null && appliedYear !== null) {
            if (calendarMonth !== appliedMonth || calendarYear !== appliedYear) {
              // Calendar changed to something different from what user applied - unlock
              setIsMonthSelectionLocked(false);
              setAppliedMonth(null);
              setAppliedYear(null);
            }
            // If it matches what user applied, keep it locked
          } else {
            // No applied selection, so unlock
            setIsMonthSelectionLocked(false);
          }
        }
      }
    } catch {
      // ignore
    }
  }, [schedulingCase?.calendar?.days, appliedMonth, appliedYear]);

  const applySelectedMonth = async () => {
    try {
      const days = generateMonth(selectedYear, selectedMonth);
      dispatch({ type: 'GENERATE_DAYS', payload: days });
      setIsMonthSelectionLocked(true);
      setAppliedMonth(selectedMonth);
      setAppliedYear(selectedYear);
      addLog(`[INFO] Calendar updated to ${selectedYear}-${String(selectedMonth).padStart(2, '0')}`, 'success');
    } catch (err) {
      console.error('Failed to generate selected month:', err);
      addLog('[ERROR] Failed to generate selected month', 'error');
    }
  };

  const handleCancelMonthSelection = () => {
    setIsMonthSelectionLocked(false);
    setAppliedMonth(null);
    setAppliedYear(null);
    addLog('[INFO] Month selection unlocked', 'info');
  };

  // Function to get all available result folders
  const getAvailableResultFolders = async () => {
    addLog('[INFO] Fetching available result folders...', 'info');
    const folders: Array<{
      name: string;
      path: string;
      created: string;
      fileCount: number;
    }> = [];

    try {
      // Try Next.js serverless listing first
      addLog('[INFO] Checking for serverless results (Vercel Blob)...', 'info');
      try {
        const respServerless = await fetch('/api/list/result-folders');
        if (respServerless.ok) {
          const data = await respServerless.json();
          const serverlessFolders = data.folders || [];
          addLog(`[INFO] Found ${serverlessFolders.length} folder(s) in Vercel Blob.`, 'success');
          serverlessFolders.forEach((f: { name: string; path: string; created: string; fileCount: number }) => {
            if (!folders.some(existing => existing.name === f.name)) folders.push(f);
          });
        } else {
          addLog(`[WARN] Serverless listing failed with status: ${respServerless.status}`, 'warning');
        }
      } catch (err) {
        addLog(`[ERROR] Could not fetch serverless results: ${err}`, 'error');
      }

      // If local solver is available, also query its listing and merge
      if (localSolverAvailable) {
        addLog('[INFO] Checking for local results (localhost:8000)...', 'info');
        try {
          const response = await fetch('http://localhost:8000/results/folders');
          if (response.ok) {
            const data = await response.json();
            const localFolders = data.folders || [];
            addLog(`[INFO] Found ${localFolders.length} folder(s) from local solver.`, 'success');
            localFolders.forEach((f: { name: string; path: string; created: number | string; fileCount: number }) => {
              const createdIso = typeof f.created === 'number' ? new Date(f.created * 1000).toISOString() : f.created;
              if (!folders.some(existing => existing.name === f.name)) {
                folders.push({ name: f.name, path: f.path, created: createdIso, fileCount: f.fileCount });
              }
            });
          } else {
            addLog(`[WARN] Local solver listing failed with status: ${response.status}`, 'warning');
          }
        } catch (err) {
          addLog(`[ERROR] Could not fetch local results: ${err}`, 'error');
        }
      } else {
        addLog('[INFO] Local solver not available, skipping local folder check.', 'info');
      }

    } catch (error) {
      addLog(`[ERROR] Unhandled error in getAvailableResultFolders: ${error}`, 'error');
    }

    addLog(`[INFO] Total unique result folders found: ${folders.length}`, 'success');
    return folders.sort((a, b) => parseInt(b.name.split('_')[1], 10) - parseInt(a.name.split('_')[1], 10));
  };

  const handleSmartInstall = async () => {
    addLog('[ACTION] Starting Smart Install (Complete Package)...', 'info');
    
    try {
      // Download the complete ZIP package
  addLog('[INFO] Downloading complete local solver package...', 'info');
      
      const response = await fetch('/api/download/local-solver');
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      
      // Get the ZIP file as blob
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'local-solver-package.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
  addLog('[OK] Complete local solver package downloaded!', 'success');
        addLog(`[INFO] Package size: ${(blob.size / 1024).toFixed(1)} KB`, 'info');
        addLog('[INFO] Package includes:', 'info');
    addLog('  • FastAPI solver service (advanced)', 'info');
    addLog('  • Basic solver (fallback)', 'info');
    addLog('  • Start scripts for Windows/Mac/Linux', 'info');
    addLog('  • Complete documentation and setup guide', 'info');
  addLog('[ACTION] Next: Extract the ZIP file and run the start script!', 'success');
      
      // Show the appropriate guide based on platform
      const platform = navigator.platform.toLowerCase();
      const userAgent = navigator.userAgent.toLowerCase();
      
      if (platform.includes('win') || userAgent.includes('windows')) {
        showInstallGuide('windows');
      } else if (platform.includes('mac') || userAgent.includes('mac')) {
        showInstallGuide('mac');
      } else {
        showInstallGuide('linux');
      }
      
    } catch (error) {
      addLog('[ERROR] Failed to download complete package', 'error');
  addLog(`[ERROR] Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  addLog('[TIP] Try using the Settings page download link as alternative', 'info');
    }
  };

  // Helper function to show guide modal after downloads
  const showInstallGuide = (platform: 'windows' | 'mac' | 'linux') => {
    setGuidePlatform(platform);
    setShowGuideModal(true);
    setShowInstallMenu(false);
  };

  const installForWindows = async () => {
  addLog('[INFO] Installing complete package for Windows...', 'info');
    
    try {
      // Download the complete ZIP package
      const response = await fetch('/api/download/local-solver');
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'local-solver-package.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
  addLog('[OK] Complete Windows package downloaded!', 'success');
  addLog('[INFO] Extract ZIP → Double-click start_local_solver.bat', 'info');
      
      // Show the guide modal with step-by-step instructions
      showInstallGuide('windows');
      
    } catch (error) {
  addLog('[ERROR] Failed to download complete package', 'error');
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  const installForMac = async () => {
  addLog('[INFO] Installing complete package for macOS...', 'info');
    
    try {
      // Download the complete ZIP package
      const response = await fetch('/api/download/local-solver');
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'local-solver-package.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
  addLog('[OK] Complete macOS package downloaded!', 'success');
  addLog('[INFO] Extract ZIP → Terminal: chmod +x start_local_solver.sh', 'info');
  addLog('[INFO] Then run: ./start_local_solver.sh', 'info');
      
      // Show the guide modal with step-by-step instructions
      showInstallGuide('mac');
      
    } catch (error) {
  addLog('[ERROR] Failed to download complete package', 'error');
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  const installForLinux = async () => {
  addLog('[INFO] Installing complete package for Linux...', 'info');
    
    try {
      // Download the complete ZIP package
      const response = await fetch('/api/download/local-solver');
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'local-solver-package.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
  addLog('[OK] Complete Linux package downloaded!', 'success');
  addLog('[INFO] Extract ZIP → Terminal: chmod +x start_local_solver.sh', 'info');
  addLog('[INFO] Then run: ./start_local_solver.sh', 'info');
      
      // Show the guide modal with step-by-step instructions
      showInstallGuide('linux');
      
    } catch (error) {
  addLog('[ERROR] Failed to download complete package', 'error');
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  return (
    <div className="space-y-4 lg:space-y-8 animate-fade-in-up">
      {/* Solver Status */}
  <div className="relative z-50 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-4 lg:p-8 hover-glow">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`w-6 h-6 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center ${
              localSolverAvailable === true 
                ? 'bg-gradient-to-br from-green-500 to-emerald-500' 
                : localSolverAvailable === false 
                  ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                  : 'bg-gradient-to-br from-gray-400 to-gray-500'
            }`}>
              {localSolverAvailable === true ? (
                <IoRocketSharp className="w-3 h-3 lg:w-4 lg:h-4 text-white" />
              ) : (
                <IoCloudSharp className="w-3 h-3 lg:w-4 lg:h-4 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-lg lg:text-xl font-bold text-gradient">
                {localSolverAvailable === true 
                  ? 'Local High-Performance Mode Active' 
                  : localSolverAvailable === false 
                    ? 'Enable Local High-Performance Mode' 
                    : 'Checking Mode...'}
              </h3>
              <p className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
                {localSolverAvailable === true 
                  ? '10-100x faster optimization with OR-Tools' 
                  : localSolverAvailable === false 
                    ? 'Install local files for faster computation and better performance'
                    : 'Detecting available optimization engines...'}
              </p>
            </div>
          </div>
          {localSolverAvailable === false && (
            <div className="relative z-50" ref={installMenuRef}>
              <button
                onClick={() => setShowInstallMenu(!showInstallMenu)}
                className="relative px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl hover:from-blue-600 hover:to-cyan-600 font-semibold flex items-center justify-center space-x-3 transition-all duration-300 shadow-lg overflow-hidden group min-w-[200px]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-cyan-400 opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                <IoRocketSharp className="w-5 h-5 z-10" />
                <span className="z-10">Enable Local Solver</span>
              </button>
              
              {/* Installation Menu Dropdown */}
              {showInstallMenu && createPortal(
                <div
                  ref={portalMenuRef}
                  className="fixed z-[9999] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden animate-fade-in-up"
                  style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px`, width: `${Math.max(menuPosition.width, 320)}px` }}
                >
                  <div className="p-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
                      <IoRocketSharp className="w-5 h-5 text-blue-500" />
                      <span>Install Local Solver</span>
                    </h3>
                    
                    <div className="space-y-3">
                      {/* Smart Install Button */}
                      <button
                        onClick={handleSmartInstall}
                        className="w-full relative px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 font-semibold flex items-center justify-center space-x-3 transition-all duration-200 shadow-md overflow-hidden group"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                        <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center z-10">
                          <IoDownloadSharp className="w-5 h-5 text-white z-10" />
                        </div>
                        <span className="z-10">Smart Install (Auto-detect OS)</span>
                      </button>
                      
                      {/* Manual Platform Selection */}
                      <div className="border-t border-gray-200 dark:border-gray-600 pt-3 mt-3">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Or choose manually:</p>
                        
                        <div className="space-y-2">
                          <button
                            onClick={installForWindows}
                            className="w-full px-4 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 font-medium flex items-center justify-center space-x-3 transition-all duration-200"
                          >
                            <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                              <IoDesktopSharp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <span>Windows (.bat)</span>
                          </button>
                          
                          <button
                            onClick={installForMac}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 font-medium flex items-center justify-center space-x-3 transition-all duration-200"
                          >
                            <div className="w-8 h-8 bg-gray-500/20 rounded-lg flex items-center justify-center">
                              <SiApple className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                            </div>
                            <span>macOS (.sh)</span>
                          </button>
                          
                          <button
                            onClick={installForLinux}
                            className="w-full px-4 py-3 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/40 font-medium flex items-center justify-center space-x-3 transition-all duration-200"
                          >
                            <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center">
                              <SiLinux className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                            </div>
                            <span>Linux (.sh)</span>
                          </button>
                        </div>
                      </div>
                      
                      {/* Help Text */}
                      <div className="border-t border-gray-200 dark:border-gray-600 pt-3 mt-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                          Downloads installation files and provides setup instructions
                        </p>
                      </div>
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </div>
          )}
        </div>
        
        {solverInfo && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Capabilities</div>
              <div className="space-y-1">
                {solverInfo.capabilities?.map((capability, index) => (
                  <div key={index} className="text-xs text-gray-600 dark:text-gray-400">
                    {capability}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Performance</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {localSolverAvailable ? 
                  "High-performance OR-Tools optimization" :
                  "Basic constraint satisfaction (sufficient for most cases)"
                }
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Installation Check Section */}
      {localSolverAvailable === false && (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-4 lg:p-8 hover-glow">
          <div className="flex items-center space-x-3 mb-4 lg:mb-6">
            <div className="w-6 h-6 lg:w-8 lg:h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <IoSync className="w-3 h-3 lg:w-4 lg:h-4 text-white" />
            </div>
            <h2 className="text-xl lg:text-2xl font-bold text-gradient">
              Local Mode Setup
            </h2>
          </div>
          
          <div className="flex flex-col space-y-4">
            {/* Check Installation Button */}
            <div className="flex items-center space-x-3">
              <button
                onClick={checkInstallationStatus}
                disabled={isCheckingInstallation}
                className={`relative px-6 py-3 rounded-xl font-semibold transition-all duration-300 flex items-center space-x-3 ${
                  isCheckingInstallation
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : installationStatus.checked
                      ? installationStatus.filesInstalled && installationStatus.pythonAvailable
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600'
                        : installationStatus.filesInstalled
                          ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white hover:from-yellow-600 hover:to-orange-600'
                          : 'bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600'
                      : 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:from-blue-600 hover:to-cyan-600'
                }`}
              >
                {isCheckingInstallation ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Checking Installation...</span>
                  </>
                ) : (
                  <>
                    <IoSync className="w-5 h-5" />
                    <span>Check Local Mode Setup</span>
                    {installationStatus.checked && (
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        installationStatus.filesInstalled && installationStatus.pythonAvailable
                          ? 'bg-green-500/20 text-white'
                          : installationStatus.filesInstalled
                            ? 'bg-yellow-500/20 text-white'
                            : 'bg-red-500/20 text-white'
                      }`}>
                        {installationStatus.filesInstalled && installationStatus.pythonAvailable
                          ? 'Ready'
                          : installationStatus.filesInstalled
                            ? 'Auto-Start'
                            : 'Setup Needed'}
                      </span>
                    )}
                  </>
                )}
              </button>
              
              {/* Clear Status Button */}
              {installationStatus.checked && (
                <div className="flex space-x-3">
                  <button
                    onClick={clearInstallationStatus}
                    className="px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                    title="Clear cached status and check again"
                  >
                    Clear Status
                  </button>
                  
                  {/* Quick Start Server Button - Only show when files exist but server not running */}
                  {installationStatus.filesInstalled && !installationStatus.pythonAvailable && (
                    <button
                      onClick={() => {
                        addLog('[ACTION] Opening quick start instructions...', 'info');
                        const platform = navigator.platform.toLowerCase();
                        const isWindows = platform.includes('win');
                        const instructions = isWindows 
                          ? 'Double-click the downloaded "start_local_solver.bat" file in your Downloads folder'
                          : 'Open Terminal, navigate to Downloads folder, and run: ./start_local_solver.sh';
                        
                        addLog(`[TIP] Quick Start: ${instructions}`, 'info');
                        addLog('[TIP] After starting, come back and click "Check Local Mode Setup"', 'info');
                        
                        // Also try to open the downloads folder
                        const link = document.createElement('a');
                        link.href = '/start_local_solver.bat';
                        link.download = 'start_local_solver.bat';
                        link.click();
                      }}
                      className="px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl hover:from-blue-600 hover:to-cyan-600 transition-all font-medium flex items-center space-x-2"
                    >
                      <IoPlaySharp className="w-4 h-4" />
                      <span>Quick Start Server</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            
            {/* Installation Status Display */}
            {installationStatus.checked && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300">Installation Status</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Last checked: {installationStatus.lastChecked && new Date(installationStatus.lastChecked).toLocaleString()}
                  </span>
                </div>
                
                {installationStatus.installedFiles.length > 0 && (
                  <div className="mb-3">
                    <p className="text-green-600 dark:text-green-400 font-medium mb-2 text-sm">
                                    [OK] Installed ({installationStatus.installedFiles.length}):
                                  </p>
                    <ul className="space-y-1">
                      {installationStatus.installedFiles.map(file => (
                        <li key={file} className="text-green-600 dark:text-green-400 text-sm flex items-center space-x-2">
                          <IoCheckmarkDoneSharp className="w-4 h-4 flex-shrink-0" />
                          <span>{file}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {installationStatus.missingFiles.length > 0 && (
                  <div className="mb-3">
                    <p className="text-orange-600 dark:text-orange-400 font-medium mb-2 text-sm">
                      [ERROR] Missing ({installationStatus.missingFiles.length}):
                    </p>
                    <ul className="space-y-1">
                      {installationStatus.missingFiles.map(file => (
                        <li key={file} className="text-orange-600 dark:text-orange-400 text-sm flex items-center space-x-2">
                          <IoWarningSharp className="w-4 h-4 flex-shrink-0" />
                          <span>{file}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Status Summary */}
                <div className={`p-3 rounded-lg ${
                  installationStatus.filesInstalled && installationStatus.pythonAvailable
                    ? 'bg-green-100 dark:bg-green-900/30' 
                    : installationStatus.filesInstalled
                      ? 'bg-yellow-100 dark:bg-yellow-900/30'
                      : 'bg-orange-100 dark:bg-orange-900/30'
                }`}>
                  <div className="flex items-center space-x-3">
                    {installationStatus.filesInstalled && installationStatus.pythonAvailable ? (
                      <IoCheckmarkDoneSharp className="w-6 h-6 text-green-600 dark:text-green-400" />
                    ) : (
                      <IoWarningSharp className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                    )}
                    <div>
                      <p className={`font-medium text-sm ${
                        installationStatus.filesInstalled && installationStatus.pythonAvailable
                          ? 'text-green-700 dark:text-green-300' 
                          : 'text-orange-700 dark:text-orange-300'
                      }`}>
                        {installationStatus.filesInstalled && installationStatus.pythonAvailable
                          ? '[OK] Local Mode Fully Ready!' 
                          : installationStatus.filesInstalled
                            ? '[INFO] Files Ready - Server Not Running'
                            : '[WARN] Setup Required'}
                      </p>
                      <p className={`text-xs ${
                        installationStatus.filesInstalled && installationStatus.pythonAvailable
                          ? 'text-green-600 dark:text-green-400' 
                          : installationStatus.filesInstalled
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-orange-600 dark:text-orange-400'
                      }`}>
                        {installationStatus.filesInstalled && installationStatus.pythonAvailable
                          ? 'You can now use the "Local" run option for high-performance optimization' 
                          : installationStatus.filesInstalled
                            ? 'Click "Local" to run - the server will start automatically!'
                            : 'Download the required files using "Enable Local Solver" button above'}
                      </p>
                    </div>
                  </div>
                  
                  {/* Server Status Indicator */}
                  {installationStatus.filesInstalled && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Local Server Status:</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                          installationStatus.pythonAvailable
                            ? 'bg-green-500 text-white'
                            : 'bg-red-500 text-white'
                        }`}>
                          {installationStatus.pythonAvailable ? '[RUNNING] Running' : '[NOT RUNNING] Not Running'}
                        </span>
                      </div>
                      {!installationStatus.pythonAvailable && (
                        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                          [TIP] No manual setup needed - just click &quot;Local&quot; to run and it will auto-start!
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Run Settings */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-4 lg:p-8 hover-glow">
        <div className="flex items-center space-x-3 mb-4 lg:mb-6">
          <div className="w-6 h-6 lg:w-8 lg:h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
            <IoSettingsSharp className="w-3 h-3 lg:w-4 lg:h-4 text-white" />
          </div>
          <h2 className="text-xl lg:text-2xl font-bold text-gradient">
            Run Settings
          </h2>
        </div>
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {/* Output Folder Name */}
          <div>
            <label className="block text-xs lg:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Output Folder Name
            </label>
            <input
              type="text"
              value={schedulingCase.run.out}
              readOnly
              title="Output folder is auto-generated (Result_N). You cannot edit this value here."
              className="w-full px-3 lg:px-4 py-2 lg:py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 backdrop-blur-sm transition-all duration-200 text-sm lg:text-base cursor-not-allowed"
            />
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Output folder is auto-generated. It will be created as the next Result_N.</div>
          </div>

          {/* Month and Year Selection */}
          <div className="col-span-full sm:col-span-2 lg:col-span-1">
            <label className="block text-xs lg:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Month for Script
            </label>
            <div className="flex space-x-2">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                disabled={isMonthSelectionLocked}
                className={`w-full px-3 lg:px-4 py-2 lg:py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md text-sm lg:text-base ${isMonthSelectionLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(0, i).toLocaleString('default', { month: 'long' })}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                disabled={isMonthSelectionLocked}
                className={`w-24 px-3 lg:px-4 py-2 lg:py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md text-sm lg:text-base ${isMonthSelectionLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <button
                onClick={isMonthSelectionLocked ? handleCancelMonthSelection : applySelectedMonth}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl hover:from-blue-600 hover:to-cyan-600 font-semibold transition-all duration-200 shadow-md text-sm lg:text-base"
              >
                {isMonthSelectionLocked ? 'Cancel' : 'Apply'}
              </button>
            </div>
            <div className={`mt-1 text-xs ${isMonthSelectionLocked ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {isMonthSelectionLocked ? 'The month has been selected.' : 'Select the month and year for the scheduling script.'}
            </div>
          </div>
          
          {/* k (Solutions) */}
          <div>
            <label className="block text-xs lg:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              k (Solutions)
            </label>
            <input
              type="number"
              value={schedulingCase.run.k}
              onChange={(e) => updateRunConfig('k', parseInt(e.target.value) || 0)}
              className="w-full px-3 lg:px-4 py-2 lg:py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md text-sm lg:text-base"
            />
          </div>
          
          <div>
            <label className="block text-xs lg:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              L (Variety)
            </label>
            <input
              type="number"
              value={schedulingCase.run.L}
              onChange={(e) => updateRunConfig('L', parseInt(e.target.value) || 0)}
              className="w-full px-3 lg:px-4 py-2 lg:py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md text-sm lg:text-base"
            />
          </div>
          
          <div>
            <label className="block text-xs lg:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Seed
            </label>
            <input
              type="number"
              value={schedulingCase.run.seed}
              onChange={(e) => updateRunConfig('seed', parseInt(e.target.value) || 0)}
              className="w-full px-3 lg:px-4 py-2 lg:py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md text-sm lg:text-base"
            />
          </div>
          
          <div>
            <label className="flex items-center space-x-2 text-xs lg:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              <IoTimerSharp className="w-3 h-3 lg:w-4 lg:h-4" />
              <span>Time (Seconds)</span>
            </label>
            <input
              type="number"
              value={schedulingCase.run.time}
              onChange={(e) => updateRunConfig('time', parseFloat(e.target.value) || 0)}
              className="w-full px-3 lg:px-4 py-2 lg:py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md text-sm lg:text-base"
            />
          </div>
        </div>
      </div>

      {/* Run Controls */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-4 lg:p-8 hover-glow">
        <div className="flex items-center space-x-3 mb-4 lg:mb-6">
          <div className="w-6 h-6 lg:w-8 lg:h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
            <IoCodeSlash className="w-3 h-3 lg:w-4 lg:h-4 text-white" />
          </div>
          <h2 className="text-xl lg:text-2xl font-bold text-gradient">
            Optimization Control
          </h2>
        </div>
        {/* Enhanced Solver Mode Selection */}
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-6">
          {/* Smart Run Button (Auto-detect) */}
          

          {/* Local Solver Button */}
          <div className="flex alg flex-col">
            <button
              onClick={() => handleRunSolver('local')}
              disabled={isRunning || !localSolverAvailable || !isMonthSelectionLocked}
              className={`relative px-6 py-4 rounded-2xl font-bold text-base flex flex-col items-center justify-center space-y-2 transition-all duration-300 shadow-lg hover:shadow-2xl overflow-hidden group min-h-[120px] ${
                isRunning
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : localSolverAvailable
                    ? 'bg-gradient-to-br from-orange-500 via-red-500 to-pink-600 text-white hover:from-orange-600 hover:via-red-600 hover:to-pink-700 hover:scale-[1.02] transform'
                    : 'bg-gradient-to-br from-gray-400 to-gray-500 text-white opacity-60 cursor-not-allowed'
              } backdrop-blur-sm border border-white/20 dark:border-gray-700/50`}
              title={localSolverAvailable ? 'Run with local high-performance solver (10-100x faster)' : 'Local server not running - use AWS Cloud instead or start server manually'}
            >
              {/* Animated background glow - only when available */}
              {localSolverAvailable && !isRunning && (
                <div className="absolute inset-0 bg-gradient-to-br from-orange-400/20 via-red-400/20 to-pink-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              )}
              
              {/* Shimmer effect - only when available */}
              {localSolverAvailable && !isRunning && (
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/10 to-transparent transform skew-x-12"></div>
              )}
              
              <div className="relative z-10 flex flex-col items-center space-y-2">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <IoRocketSharp className="w-6 h-6" />
                </div>
                <span className="font-bold">Local</span>
                <span className="text-xs opacity-90 font-medium">
                  {localSolverAvailable ? '(10-100x faster)' : '(Run .bat/.sh to Activate)'}
                </span>
              </div>
            </button>
            
            {/* Status indicator */}
            <div className="mt-2 text-center">
              {localSolverAvailable ? (
                <div className="inline-flex items-center space-x-1 px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-medium">
                  <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse"></div>
                  <span>High Performance</span>
                </div>
              ) : (
                <div className="inline-flex items-center space-x-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800/30 text-gray-600 dark:text-gray-400 text-xs font-medium">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
                  <span>Not Running</span>
                </div>
              )}
            </div>
          </div>

          {/* AWS Cloud Solver Button */}
          <div className="flex flex-col">
            <button
              onClick={() => handleRunSolver('aws')}
              disabled={isRunning || !isMonthSelectionLocked}
              className={`relative px-6 py-4 rounded-2xl font-bold text-base flex flex-col items-center justify-center space-y-2 transition-all duration-300 shadow-lg hover:shadow-2xl overflow-hidden group min-h-[120px] ${
                isRunning
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 text-white hover:from-blue-600 hover:via-indigo-600 hover:to-purple-700 hover:scale-[1.02] transform'
              } backdrop-blur-sm border border-white/20 dark:border-gray-700/50`}
              title="Run with AWS cloud solver (scalable, always available)"
            >
              {/* Animated background glow */}
              {!isRunning && (
                <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 via-indigo-400/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              )}
              
              {/* Shimmer effect */}
              {!isRunning && (
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/10 to-transparent transform skew-x-12"></div>
              )}
              
              <div className="relative z-10 flex flex-col items-center space-y-2">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <IoCloudSharp className="w-6 h-6" />
                </div>
                <span className="font-bold">AWS Cloud</span>
                <span className="text-xs opacity-90 font-medium">
                  (Scalable & Always On)
                </span>
              </div>
            </button>
            
            {/* Status indicator */}
            <div className="mt-2 text-center">
              <div className="inline-flex items-center space-x-1 px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Cloud Ready</span>
              </div>
            </div>
          </div>

          {/* Serverless Button */}
        
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-wrap gap-3 mb-6">
          {/* Applied Month status (constrainer) */}
          <div className="flex items-center space-x-3 w-full lg:w-auto">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Applied Month: <span className="font-semibold">{appliedMonth ? `${new Date(appliedYear || 0, (appliedMonth || 1) - 1).toLocaleString(undefined, { month: 'long' })} ${appliedYear}` : 'None'}</span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {isMonthSelectionLocked ? 'The month has been selected.' : 'Select Month for Script and click Apply to enable runs.'}
            </div>
          </div>
          {/* Stop Process Button - only show when running */}
          {isRunning && (
            <button
              onClick={stopSolver}
              className="relative px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl hover:from-red-600 hover:to-red-700 font-semibold flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-red-300/20 to-red-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <IoStopSharp className="w-5 h-5 relative z-10" />
              <span className="relative z-10">Stop Process</span>
            </button>
          )}
          
          {/* Open Output Folder */}
          {/* <button
            onClick={handleOpenOutputFolder}
            className="relative px-6 py-3 bg-gradient-to-r from-slate-600 to-slate-700 dark:from-slate-700 dark:to-slate-800 text-white rounded-xl hover:from-slate-700 hover:to-slate-800 dark:hover:from-slate-600 dark:hover:to-slate-700 font-semibold flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-slate-400/20 to-slate-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <IoFolderOpenSharp className="w-5 h-5 relative z-10" />
            <span className="relative z-10">
              {lastResults ? 'View Results' : 'View Output Folder'}
            </span>
          </button> */}

          {/* Export Latest Schedule */}
          {/* <button
            onClick={handleExportLatestSchedule}
            className="relative px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl hover:from-green-700 hover:to-green-800 font-semibold flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-green-400/20 to-green-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <IoDownloadSharp className="w-5 h-5 relative z-10" />
            <span className="relative z-10">Export Latest Schedule</span>
          </button> */}

          {/* Clear Logs */}
          <button
            onClick={clearLogs}
            className="relative px-6 py-3 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl hover:from-amber-700 hover:to-orange-700 font-semibold flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-amber-400/20 to-orange-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <IoTerminalSharp className="w-5 h-5 relative z-10" />
            <span className="relative z-10">Clear Logs</span>
          </button>

          {/* View Past Results */}
          <button
            onClick={() => setShowResultsManager(true)}
            className="relative px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl hover:from-purple-700 hover:to-purple-800 font-semibold flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <IoFolderOpenSharp className="w-5 h-5 relative z-10" />
            <span className="relative z-10">View Past Results</span>
          </button>

          {/* Data Management */}
          {/* <button
            onClick={() => setShowDataManagementModal(true)}
            className="relative px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl hover:from-purple-700 hover:to-purple-800 font-semibold flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <IoServerSharp className="w-5 h-5 relative z-10" />
            <span className="relative z-10">Data Backup</span>
          </button> */}
        </div>

        {/* Progress Bar */}
        {isRunning && (
          <div className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20 rounded-xl p-4 lg:p-6 border border-blue-200/50 dark:border-blue-800/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs lg:text-sm font-semibold text-gray-700 dark:text-gray-300">Optimization Progress</span>
              </div>
              <span className="text-base lg:text-lg font-bold text-blue-600 dark:text-blue-400">{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 lg:h-3 shadow-inner">
              <div
                className="bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 h-2 lg:h-3 rounded-full transition-all duration-500 ease-out shadow-lg"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 text-center">
              {progress < 2 ? '[INIT] Starting optimization engine...' :
               progress < 5 ? '[INIT] Loading solver configuration...' :
               progress < 8 ? '[INIT] Validating input data...' :
               progress < 10 ? '[INIT] Preparing optimization environment...' :
               progress < 12 ? '[INIT] Initializing constraints system...' :
               progress < 15 ? '[INIT] Setting up optimization parameters...' :
               progress < 18 ? '[BUILD] Creating optimization model...' :
               progress < 22 ? '[BUILD] Configuring solver settings...' :
               progress < 25 ? '[BUILD] Building constraint framework...' :
               progress < 28 ? '[BUILD] Preparing model structure...' :
               progress < 32 ? '[VAR] Generating decision variables...' :
               progress < 38 ? '[VAR] Creating shift assignment variables...' :
               progress < 42 ? '[VAR] Building variable relationships...' :
               progress < 45 ? '[CONST] Adding capacity constraints...' :
               progress < 48 ? '[CONST] Enforcing shift requirements...' :
               progress < 52 ? '[CONST] Setting provider limits...' :
               progress < 56 ? '[CONST] Adding schedule constraints...' :
               progress < 60 ? '[CONST] Finalizing constraint system...' :
               progress < 62 ? '[OBJ] Defining optimization objective...' :
               progress < 65 ? '[OBJ] Setting optimization goals...' :
               progress < 68 ? '[PREP] Configuring solver parameters...' :
               progress < 70 ? '[PREP] Optimizing search strategy...' :
               progress < 72 ? '[PREP] Preparing solver execution...' :
               progress < 74 ? '[SOLVE] Starting constraint solver...' :
               progress < 76 ? '[SOLVE] Searching for solutions...' :
               progress < 78 ? '[SOLVE] Evaluating candidates...' :
               progress < 82 ? '[SOLVE] Optimizing assignments...' :
               progress < 85 ? '[POST] Processing solutions...' :
               progress < 88 ? '[POST] Validating results...' :
               progress < 90 ? '[POST] Calculating statistics...' :
               progress < 92 ? '[POST] Preparing output data...' :
               progress < 94 ? '[FILE] Generating schedule files...' :
               progress < 96 ? '[FILE] Creating result documents...' :
               progress < 98 ? '[FILE] Saving output files...' :
               progress < 100 ? '[FINAL] Completing optimization...' :
               '[DONE] Optimization complete!'}
            </div>
          </div>
        )}
      </div>

      {/* Log Output */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-4 lg:p-8 hover-glow">
        <div className="flex items-center space-x-3 mb-4 lg:mb-6">
          <div className="w-6 h-6 lg:w-8 lg:h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
            <IoTerminalSharp className="w-3 h-3 lg:w-4 lg:h-4 text-white" />
          </div>
          <h3 className="text-xl lg:text-2xl font-bold text-gradient">
            System Log
          </h3>
        </div>
  <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-green-400 p-3 lg:p-6 rounded-xl font-mono text-xs lg:text-sm h-[40vh] sm:h-64 lg:h-80 overflow-y-auto shadow-inner border border-gray-700">
          {logs.length === 0 ? (
            <div className="text-gray-500 italic flex flex-col lg:flex-row items-center justify-center space-y-2 lg:space-y-0 lg:space-x-2 py-8 text-center">
              <IoTerminalSharp className="w-5 h-5 lg:w-6 lg:h-6" />
              <span>Waiting for optimization to start...</span>
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="mb-2 flex items-start space-x-2 animate-fade-in-up">
                <span className="text-yellow-400 font-bold text-xs mt-0.5">•</span>
                <span className="flex-1">{log}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Statistics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl shadow-lg border border-blue-200/50 dark:border-blue-800/50 p-6 hover-glow hover:scale-105 transition-all duration-300">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">{schedulingCase.shifts.length}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Total Shifts</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">Scheduled</p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl shadow-lg border border-green-200/50 dark:border-green-800/50 p-6 hover-glow hover:scale-105 transition-all duration-300">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">{schedulingCase.providers.length}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Active Providers</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400">Available</p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-xl shadow-lg border border-purple-200/50 dark:border-purple-800/50 p-6 hover-glow hover:scale-105 transition-all duration-300">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              {getSolverIcon()}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Optimization</p>
              <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{getSolverText()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Local Solver Installation Guide Modal */}
      <LocalSolverGuideModal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        platform={guidePlatform}
      />
      
      {/* Data Management Modal */}
      <DataManagementModal
        isOpen={showDataManagementModal}
        onClose={() => setShowDataManagementModal(false)}
      />

      {/* Downloadable Files Modal */}
      {showFilesMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-lg rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200/50 dark:border-gray-700/50">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                  <IoFolderOpenSharp className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    Available Result Folders
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Download complete result folders with all optimization outputs
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowFilesMenu(false)}
                className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                X
              </button>
            </div>

            {/* Files List */}
            <div className="p-6 max-h-[60vh] sm:max-h-96 overflow-y-auto">
              {loadingFiles ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3"></div>
                  <span className="text-gray-600 dark:text-gray-300">Loading files...</span>
                </div>
              ) : availableFiles.length > 0 ? (
                <div className="space-y-3">
                  {availableFiles.map((folder, index) => {
                    const fileCountText = folder.fileCount === 1 ? '1 file' : `${folder.fileCount} files`;
                    const modifiedDate = new Date(folder.modified).toLocaleString();
                    
                    return (
                      <div 
                        key={index}
                        className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 hover:bg-gray-100 dark:hover:bg-gray-600/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3 flex-1">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                              <IoFolderOpenSharp className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900 dark:text-white truncate">
                                {folder.name}
                              </h4>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {fileCountText} • Created {modifiedDate}
                              </p>
                              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                Complete optimization results with schedules, logs, and data files
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => downloadFile(folder)}
                            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all duration-200 font-medium shadow-lg flex items-center space-x-2 hover:scale-105"
                          >
                            <IoDownloadSharp className="w-4 h-4" />
                            <span>Download</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                    <IoFolderOpenSharp className="w-8 h-8 text-gray-400" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    No result folders available
                  </h4>
                  <p className="text-gray-500 dark:text-gray-400">
                    Run the optimization first to generate downloadable result folders
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-gray-200/50 dark:border-gray-700/50 p-4 bg-gray-50/50 dark:bg-gray-700/50">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {availableFiles.length} folder{availableFiles.length !== 1 ? 's' : ''} available
                </p>
                <button
                  onClick={() => setShowFilesMenu(false)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results Manager Modal */}
      <ResultsManager
        isOpen={showResultsManager}
        onClose={() => setShowResultsManager(false)}
      />
    </div>
  );
}
