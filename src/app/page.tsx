'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useScheduling } from '@/context/SchedulingContext';
import { loadCaseFromFile } from '@/lib/scheduling';
import { exportCurrentCaseToExcel, generateMockResults, exportScheduleToExcel } from '@/lib/excelExport';
import RunTab from '@/components/tabs/RunTab';
import CalendarTab from '@/components/tabs/CalendarTab';
import ShiftsTab from '@/components/tabs/ShiftsTab';
import ProvidersTab from '@/components/tabs/ProvidersTab';
import ConfigTab from '@/components/tabs/ConfigTab';
import { 
  IoPlaySharp, 
  IoCalendarSharp, 
  IoTimeSharp, 
  IoPeopleSharp, 
  IoSettingsSharp,
  IoDocumentTextSharp,
  IoStatsChartSharp,
  IoCogSharp
} from 'react-icons/io5';

type TabType = 'run' | 'calendar' | 'shifts' | 'providers' | 'config';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { state, dispatch } = useScheduling();
  const [activeTab, setActiveTab] = useState<TabType>('run');
  const [isInitialized, setIsInitialized] = useState(false);

  // Authentication check - redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return; // Still loading
    
    console.log('[INFO] Auth status:', { status, session: !!session, role: session?.user?.role });
    
    if (!session) {
      console.log('[WARN] No session found, redirecting to login');
      router.push('/login');
      return;
    }
    
    if (session.user?.role !== 'admin') {
      console.log('[WARN] User is not admin, redirecting to login');
      router.push('/login');
      return;
    }
    
    console.log('[OK] User is authenticated with admin role');
  }, [session, status, router]);

  useEffect(() => {
    const initializeApp = async () => {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      try {
        const caseData = await loadCaseFromFile();
        if (caseData) {
          dispatch({ type: 'LOAD_CASE', payload: caseData });
        }
      } catch {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to load case data' });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
        setIsInitialized(true);
      }
    };

    initializeApp();
  }, [dispatch]);

  const handleExportConfiguration = () => {
    // Prefer the configuration snapshot from the most recent run when available
    const configToExport = state.lastResults?.caseSnapshot ?? state.case;
    exportCurrentCaseToExcel(configToExport);
  };

  const handleExportResults = () => {
    // Prefer last results and the exact case snapshot saved at run time
    const resultsSource = state.lastResults;
    if (resultsSource && resultsSource.results) {
      // Transform solver results to match export format
      const solverResults = resultsSource.results as {
        assignments?: Array<{
          shift_id: string;
          provider_id: string;
          provider_name: string;
          date: string;
          shift_type: string;
          start_time: string;
          end_time: string;
        }>;
        summary?: {
          total_assignments?: number;
          provider_workload?: Record<string, number>;
          shift_coverage?: Record<string, number>;
        };
      };
      
      if (solverResults.assignments && solverResults.summary) {
        const transformedResults = {
          assignments: solverResults.assignments.map(assignment => ({
            date: assignment.date,
            shiftId: assignment.shift_id,
            shiftType: assignment.shift_type,
            providerId: assignment.provider_id,
            providerName: assignment.provider_name,
            startTime: assignment.start_time,
            endTime: assignment.end_time
          })),
          summary: {
            totalAssignments: solverResults.summary.total_assignments || 0,
            providerWorkload: solverResults.summary.provider_workload || {},
            shiftCoverage: solverResults.summary.shift_coverage || {}
          }
        };

        // Use the case snapshot saved with the run if available, otherwise current case
        const caseForExport = (state.lastResults && state.lastResults.caseSnapshot) ? state.lastResults.caseSnapshot : state.case;
        exportScheduleToExcel(caseForExport, transformedResults);
        return;
      }
    }
    
    // Fallback to mock results for demo if no real results available
    const caseForMock = state.lastResults?.caseSnapshot ?? state.case;
    const mockResults = generateMockResults(caseForMock);
    exportScheduleToExcel(caseForMock, mockResults);
  };

  const handleSignOut = () => {
    signOut({ callbackUrl: '/login' });
  };

  const handleSettings = () => {
    router.push('/settings');
  };

  const tabs = [
    { id: 'run', label: 'Run', icon: IoPlaySharp },
    { id: 'calendar', label: 'Calendar', icon: IoCalendarSharp },
    { id: 'shifts', label: 'Shifts', icon: IoTimeSharp },
    { id: 'providers', label: 'Providers', icon: IoPeopleSharp },
    { id: 'config', label: 'Config', icon: IoSettingsSharp },
  ] as const;

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'run':
        return <RunTab />;
      case 'calendar':
        return <CalendarTab />;
      case 'shifts':
        return <ShiftsTab />;
      case 'providers':
        return <ProvidersTab />;
      case 'config':
        return <ConfigTab />;
      default:
        return <RunTab />;
    }
  };

  // Show loading screen while checking authentication
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-slate-50/50 to-blue-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-slate-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (user will be redirected)
  if (!session || session.user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-slate-50/50 to-blue-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-slate-800">
        <div className="text-center">
          <p className="text-lg text-gray-600 dark:text-gray-300">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 via-slate-50/50 to-blue-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-slate-800 relative">
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-50/10 via-transparent to-teal-50/10 dark:from-blue-900/5 dark:via-transparent dark:to-teal-900/5"></div>
        <div className="relative text-center bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-12">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-transparent bg-gradient-to-r from-blue-600 via-purple-600 to-teal-600 mx-auto"></div>
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-white dark:border-gray-800 absolute top-2 left-1/2 transform -translate-x-1/2"></div>
          </div>
          <div className="mt-8">
            <p className="text-2xl font-bold text-gradient">
              Staff Scheduling
            </p>
            <div className="flex items-center justify-center space-x-2 mt-2">
              <div className="h-1 w-16 bg-gradient-to-r from-slate-400 via-blue-500 to-teal-500 rounded-full animate-pulse"></div>
              <div className="h-2 w-2 bg-gradient-to-r from-blue-500 to-teal-500 rounded-full animate-bounce"></div>
            </div>
            <p className="mt-4 text-gray-600 dark:text-gray-300 font-medium">
              Loading your scheduling system...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50/50 to-blue-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-slate-800 relative">
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-50/10 via-transparent to-teal-50/10 dark:from-blue-900/5 dark:via-transparent dark:to-teal-900/5 pointer-events-none"></div>
        <div className="relative">
        {/* Header */}
        <header className="header-gradient shadow-lg border-b border-gray-200 dark:border-gray-700 relative">
          <div className="absolute inset-0 header-overlay"></div>
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center py-4 lg:py-8 space-y-4 lg:space-y-0">
              <div className="flex flex-col space-y-2">
                <div>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-gradient break-words">
                    Staff Scheduling System
                  </h1>
                </div>
                <div className="flex items-center space-x-2 -mt-1">
                  <div className="h-1 w-20 bg-gradient-to-r from-slate-400 via-blue-500 to-teal-500 rounded-full shadow-sm"></div>
                  <div className="h-2 w-2 bg-gradient-to-r from-blue-500 to-teal-500 rounded-full animate-pulse"></div>
                </div>
                <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300 tracking-wide leading-relaxed">
                  Advanced scheduling and optimization for staff
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-3 sm:space-y-0 sm:space-x-3 lg:space-x-4">
                <div className="flex items-center justify-center sm:justify-start space-x-3 sm:space-x-4">
                  {/* Export Config Button */}
                  <div className="relative group">
                    <button
                      onClick={handleExportConfiguration}
                      className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-gradient-to-br from-green-500 via-green-600 to-emerald-600 hover:from-green-600 hover:via-green-700 hover:to-emerald-700 text-white rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl hover:shadow-xl sm:hover:shadow-2xl transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 sm:hover:-translate-y-1 flex items-center justify-center border border-green-400/30 backdrop-blur-sm group relative overflow-hidden"
                      title="Export Configuration"
                    >
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <IoDocumentTextSharp className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 relative z-10 group-hover:scale-110 transition-transform duration-200 drop-shadow-lg" />
                    </button>
                    <div className="absolute -bottom-12 sm:-bottom-14 left-1/2 transform -translate-x-1/2 bg-gray-900/90 dark:bg-gray-800/90 text-white text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap z-[9999] backdrop-blur-sm border border-gray-700/50">
                      <div className="absolute -top-1.5 sm:-top-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-3 border-r-3 border-b-3 sm:border-l-4 sm:border-r-4 sm:border-b-4 border-transparent border-b-gray-900/90 dark:border-b-gray-800/90"></div>
                      <span className="hidden sm:inline">Export Configuration</span>
                      <span className="sm:hidden">Export Config</span>
                    </div>
                  </div>

                  {/* Export Results Button */}
                  <div className="relative group">
                    <button
                      onClick={handleExportResults}
                      className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 hover:from-blue-600 hover:via-blue-700 hover:to-indigo-700 text-white rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl hover:shadow-xl sm:hover:shadow-2xl transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 sm:hover:-translate-y-1 flex items-center justify-center border border-blue-400/30 backdrop-blur-sm group relative overflow-hidden"
                      title="Export Results"
                    >
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <IoStatsChartSharp className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 relative z-10 group-hover:scale-110 transition-transform duration-200 drop-shadow-lg" />
                    </button>
                    <div className="absolute -bottom-12 sm:-bottom-14 left-1/2 transform -translate-x-1/2 bg-gray-900/90 dark:bg-gray-800/90 text-white text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap z-[9999] backdrop-blur-sm border border-gray-700/50">
                      <div className="absolute -top-1.5 sm:-top-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-3 border-r-3 border-b-3 sm:border-l-4 sm:border-r-4 sm:border-b-4 border-transparent border-b-gray-900/90 dark:border-b-gray-800/90"></div>
                      <span className="hidden sm:inline">Export Results</span>
                      <span className="sm:hidden">Export</span>
                    </div>
                  </div>

                  {/* Settings Button */}
                  <div className="relative group">
                    <button
                      onClick={handleSettings}
                      className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-gradient-to-br from-gray-500 via-gray-600 to-slate-600 hover:from-gray-600 hover:via-gray-700 hover:to-slate-700 text-white rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl hover:shadow-xl sm:hover:shadow-2xl transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 sm:hover:-translate-y-1 flex items-center justify-center border border-gray-400/30 backdrop-blur-sm group relative overflow-hidden"
                      title="Settings"
                    >
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <IoCogSharp className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 relative z-10 group-hover:scale-110 group-hover:rotate-90 transition-all duration-300 drop-shadow-lg" />
                    </button>
                    <div className="absolute -bottom-12 sm:-bottom-14 left-1/2 transform -translate-x-1/2 bg-gray-900/90 dark:bg-gray-800/90 text-white text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap z-[9999] backdrop-blur-sm border border-gray-700/50">
                      <div className="absolute -top-1.5 sm:-top-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-3 border-r-3 border-b-3 sm:border-l-4 sm:border-r-4 sm:border-b-4 border-transparent border-b-gray-900/90 dark:border-b-gray-800/90"></div>
                      <span className="hidden sm:inline">Account Settings</span>
                      <span className="sm:hidden">Settings</span>
                    </div>
                  </div>

                  {/* Sign Out Button */}
                  <div className="relative group">
                    <button
                      onClick={handleSignOut}
                      className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-gradient-to-br from-red-500 via-red-600 to-rose-600 hover:from-red-600 hover:via-red-700 hover:to-rose-700 text-white rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl hover:shadow-xl sm:hover:shadow-2xl transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 sm:hover:-translate-y-1 flex items-center justify-center border border-red-400/30 backdrop-blur-sm group relative overflow-hidden"
                      title="Sign Out"
                    >
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 relative z-10 group-hover:scale-110 transition-transform duration-200 drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </button>
                    <div className="absolute -bottom-12 sm:-bottom-14 left-1/2 transform -translate-x-1/2 bg-gray-900/90 dark:bg-gray-800/90 text-white text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap z-[9999] backdrop-blur-sm border border-gray-700/50">
                      <div className="absolute -top-1.5 sm:-top-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-3 border-r-3 border-b-3 sm:border-l-4 sm:border-r-4 sm:border-b-4 border-transparent border-b-gray-900/90 dark:border-b-gray-800/90"></div>
                      Sign Out
                    </div>
                  </div>
                </div>
                
                {state.error && (
                  <div className="bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 text-red-800 px-4 lg:px-6 py-3 lg:py-4 rounded-xl shadow-lg backdrop-blur-sm animate-fade-in-up">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                      <span className="font-medium text-sm lg:text-base break-words">{state.error}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

      {/* Tab Navigation */}
      <nav className="bg-white dark:bg-gray-800 shadow-lg border-b-2 border-gray-200 dark:border-gray-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap sm:flex-nowrap overflow-x-auto space-x-1">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`py-3 lg:py-4 px-3 sm:px-4 lg:px-6 font-semibold text-sm lg:text-base flex items-center space-x-2 lg:space-x-3 transition-all duration-200 min-w-[100px] sm:min-w-[120px] lg:min-w-[140px] justify-center border-b-3 whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-600 dark:border-blue-400'
                      : 'text-gray-700 dark:text-gray-300 border-transparent hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <IconComponent className="w-4 h-4 lg:w-5 lg:h-5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

          {/* Tab Content */}
          <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-8">
            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-4 lg:p-6 overflow-hidden">
              {renderActiveTab()}
            </div>
          </main>
        </div>
      </div>
  );
}
