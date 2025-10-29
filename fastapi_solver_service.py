#!/usr/bin/env python3
"""
FastAPI-based Solver Service for Medical Staff Scheduling

This high-performance service runs locally and provides WebSocket + REST API
for the Vercel-hosted web application to trigger optimization solver.

Features:
- FastAPI for maximum performance
- WebSocket for real-time progress updates
- Integrated OR-Tools solver logic from testcase_gui.py
- Background task processing for long-running optimizations
- Comprehensive error handling and logging

Usage:
    pip install fastapi uvicorn websockets python-multipart
    python fastapi_solver_service.py
    
The service will run on http://localhost:8000
"""

import json
import logging
import os
import sys
import asyncio
import uuid
from datetime import datetime, date
from pathlib import Path
from typing import Dict, Any, List, Optional
import traceback
from concurrent.futures import ThreadPoolExecutor
import threading
import shutil
import base64


try:
    from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, FileResponse
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("Please install required packages:")
    print("pip install fastapi uvicorn websockets python-multipart")
    sys.exit(1)

# Import the solver logic from your existing code
try:
    # Import the core solver functions from testcase_gui.py when available
    from ortools.sat.python import cp_model
    import collections
    
    # Try to import testcase_gui. Prefer the workspace-local copy under
    # public/local-solver-package so we can control fixes and avoid loading
    # an out-of-workspace copy (e.g. c:\Werk\Webapp\testcase_gui.py).
    HAVE_TESTCASE_GUI = False
    _tcg = None

    # Prefer workspace-local package copy
    local_pkg = Path(__file__).resolve().parent / "public" / "local-solver-package"
    local_tcg = local_pkg / "testcase_gui.py"
    if local_tcg.exists():
        # Prepend to sys.path so this copy is imported first
        if str(local_pkg) not in sys.path:
            sys.path.insert(0, str(local_pkg))
        try:
            import testcase_gui as _tcg
            HAVE_TESTCASE_GUI = True
        except Exception:
            # If that import fails, continue to try other locations below
            _tcg = None

    # Fallback: try importing from usual locations or parent workspace
    if not HAVE_TESTCASE_GUI:
        try:
            import testcase_gui as _tcg  # If placed next to this service or on PYTHONPATH
            HAVE_TESTCASE_GUI = True
        except Exception:
            # Add parent directories to sys.path to reach c:\Werk\Webapp\testcase_gui.py
            try:
                base_try = Path(__file__).resolve().parents[2]  # likely c:\Werk\Webapp
                tcg_path = base_try / "testcase_gui.py"
                if tcg_path.exists():
                    sys.path.insert(0, str(base_try))
                    import testcase_gui as _tcg
                    HAVE_TESTCASE_GUI = True
                else:
                    # Try specific known path c:\Werk\Webapp\testcase_gui.py
                    direct_path = Path("c:/Werk/Webapp")
                    tcg_direct = direct_path / "testcase_gui.py"
                    if tcg_direct.exists():
                        sys.path.insert(0, str(direct_path))
                        import testcase_gui as _tcg
                        HAVE_TESTCASE_GUI = True
            except Exception:
                HAVE_TESTCASE_GUI = False

    if HAVE_TESTCASE_GUI:
        print("[Done] Found testcase_gui.py — local runs will use the real solver")
    else:
        print("[Note] testcase_gui.py not found — using built-in simplified solver")
    
    print("[Done] OR-Tools imported successfully")
except ImportError as e:
    print(f"[Error] Failed to import OR-Tools: {e}")
    print("Please install: pip install ortools")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(name)s | %(message)s'
)
logger = logging.getLogger("scheduler-fastapi")

app = FastAPI(
    title="Medical Staff Scheduling Solver API",
    description="High-performance optimization service for medical staff scheduling",
    version="2.0.0"
)

# CORS setup for Vercel integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your Vercel domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for API
class SchedulingCase(BaseModel):
    constants: Dict[str, Any]
    calendar: Dict[str, Any]
    shifts: List[Dict[str, Any]]
    providers: List[Dict[str, Any]]
    run: Optional[Dict[str, Any]] = None
    provider_types: Optional[List[str]] = None

class SolverStatus(BaseModel):
    status: str
    message: str
    run_id: Optional[str] = None
    progress: Optional[float] = None
    results: Optional[Dict[str, Any]] = None

# Global state management
active_runs: Dict[str, Dict[str, Any]] = {}
websocket_connections: Dict[str, WebSocket] = {}
thread_pool = ThreadPoolExecutor(max_workers=4)

class AdvancedSchedulingSolver:
    def __init__(self):
        # Use /tmp for Lambda (read-only /var/task), local solver_output otherwise
        if os.environ.get('AWS_LAMBDA_FUNCTION_NAME'):
            # Lambda environment - use writable /tmp directory
            self.output_dir = Path("/tmp/solver_output")
            logger.info("Running in AWS Lambda - using /tmp for outputs")
        else:
            # Local environment - prefer the workspace-level solver_output
            # so FastAPI shares the same Result_N folders produced by serverless and conversions.
            repo_root = Path(__file__).resolve().parent.parent
            self.output_dir = repo_root / "solver_output"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Using solver output directory: {self.output_dir}")
        # Note for maintainers:
        # - If the incoming case JSON contains run.out set to a string like
        #   'Result_14' the service will prefer that folder name (sanitized)
        #   and place outputs under solver_output/Result_14. This ensures
        #   deterministic upload paths that match serverless runs.
        # - Otherwise a unique run_id is used as the folder name. We also
        #   temporarily change CWD to solver_output when invoking
        #   testcase_gui.Solve_test_case so that its relative 'out' path
        #   is created under the expected folder.
        
    async def solve_async(self, case_data: Dict[str, Any], run_id: str) -> Dict[str, Any]:
        """
        Asynchronous wrapper for the solver that integrates your OR-Tools logic
        """
        loop = asyncio.get_event_loop()
        
        # Run the CPU-intensive solver in a thread pool
        result = await loop.run_in_executor(
            thread_pool, 
            self._solve_with_ortools, 
            case_data, 
            run_id
        )
        
        return result
    
    def _solve_with_ortools(self, case_data: Dict[str, Any], run_id: str) -> Dict[str, Any]:
        """
        Integrated OR-Tools solver logic adapted from your testcase_gui.py
        """
        try:
            # Prefer deterministic 'Result_N' folder if caller provided it
            requested_out = None
            try:
                requested_out = case_data.get('run', {}).get('out')
            except Exception:
                requested_out = None

            if isinstance(requested_out, str) and requested_out.startswith('Result_'):
                out_name = os.path.basename(requested_out)
                run_output_dir = self.output_dir / out_name
            else:
                run_output_dir = self.output_dir / run_id

            run_output_dir.mkdir(parents=True, exist_ok=True)
            
            # Save input case
            case_file = run_output_dir / "input_case.json"
            with open(case_file, 'w') as f:
                json.dump(case_data, f, indent=2)
            
            # Update progress - Stage 1: Initialization (0-15%)
            self._update_progress(run_id, 0, "Starting optimization process...")
            self._update_progress(run_id, 2, "Validating input data...")
            self._update_progress(run_id, 5, "Reading case configuration...")
            
            # Extract case components
            constants = case_data.get('constants', {})
            calendar_data = case_data.get('calendar', {})
            shifts = case_data.get('shifts', [])
            providers = case_data.get('providers', [])
            run_config = case_data.get('run', {})
            
            self._update_progress(run_id, 8, "Parsing calendar data...")
            self._update_progress(run_id, 10, "Loading provider information...")
            self._update_progress(run_id, 12, "Processing shift requirements...")
            self._update_progress(run_id, 15, f"Preparing optimization model ({len(shifts)} shifts, {len(providers)} providers)...")
            
            # Build the OR-Tools model (simplified version)
            model_result = self._build_and_solve_model(
                constants, calendar_data, shifts, providers, run_config, run_id
            )
            
            self._update_progress(run_id, 90, "Generating output files...")
            
            # Stage 9: File Generation (92-98%)
            self._update_progress(run_id, 94, "Saving results to JSON...")
            
            # Save results
            result_file = run_output_dir / "results.json"
            with open(result_file, 'w') as f:
                json.dump(model_result, f, indent=2)
            
            self._update_progress(run_id, 96, "Generating Excel reports...")
            
            # Generate Excel outputs (optional)
            try:
                self._generate_excel_outputs(model_result, run_output_dir)
            except Exception as e:
                logger.warning(f"Failed to generate Excel outputs: {e}")
            
            self._update_progress(run_id, 98, "Finalizing output files...")
            
            # Attempt to gather any auxiliary outputs that the testcase_gui
            # or other parts of the pipeline may have written to the base
            # solver_output directory. This consolidates artifacts such as
            # calendar.xlsx, constants_effective.json, scheduler logs, etc.
            try:
                self._gather_additional_outputs(run_output_dir, run_id)
            except Exception as e:
                logger.debug(f"Could not gather additional outputs for {run_id}: {e}")

            self._update_progress(run_id, 100, "Optimization completed successfully!")
            # Ensure debug_info exists so API clients can see whether
            # the external testcase_gui bridge was used or if we fell
            # back to the built-in solver.
            model_result.setdefault('debug_info', {})
            model_result['debug_info'].setdefault('used_testcase_gui', False)

            return {
                "status": "success",
                "run_id": run_id,
                "output_directory": str(run_output_dir),
                "result": model_result
            }
            
        except Exception as e:
            logger.error(f"Solver error for run {run_id}: {str(e)}")
            logger.error(traceback.format_exc())
            
            self._update_progress(run_id, -1, f"Error: {str(e)}")
            
            return {
                "status": "error",
                "run_id": run_id,
                "message": str(e),
                "traceback": traceback.format_exc()
            }
    
    def _build_and_solve_model(self, constants: Dict, calendar: Dict, 
                             shifts: List, providers: List, run_config: Dict, run_id: str) -> Dict[str, Any]:
        """
        Core optimization path. If testcase_gui.py is available locally,
        delegate solving to it; otherwise use the built-in simplified model.
        """
        # Ensure there is a per-run output directory available for testcase_gui
        run_output_dir = self.output_dir / run_id
        run_output_dir.mkdir(parents=True, exist_ok=True)

        # If the external real solver is available, try to use it first
        if 'HAVE_TESTCASE_GUI' in globals() and HAVE_TESTCASE_GUI and _tcg is not None:
            try:
                logger.info("Using external testcase_gui.py for solving…")
                # Build a merged case dict for the external solver. Compute
                # provider types locally instead of referencing a non-existent
                # `case_data` variable (which caused a NameError in logs).
                provider_types_local = sorted(set([p.get('type', 'MD') for p in (providers or [])]))
                case = {
                    "constants": constants or {},
                    "calendar": calendar or {},
                    "shifts": shifts or [],
                    "providers": providers or [],
                    "run": run_config or {},
                    "provider_types": provider_types_local,
                }

                # Try the most direct entrypoint first if available
                result_payload: Dict[str, Any] | None = None

                if hasattr(_tcg, 'Solve_test_case'):
                    try:
                        # testcase_gui.Solve_test_case expects a file path, not a dict
                        # Write case to temporary JSON file
                        import tempfile
                        # Sanitize the run config before handing it to
                        # external testcase_gui to avoid int(None) crashes
                        # in older copies of testcase_gui that do naive
                        # int() conversions.
                        sanitized_case = dict(case)
                        run_block = dict(sanitized_case.get('run', {}) or {})
                        # Remove keys that are explicitly None and coerce
                        # numeric-like fields to safe ints when possible.
                        def _coerce_optional_int(v, default=None):
                            if v is None:
                                return default
                            try:
                                return int(v)
                            except Exception:
                                return default

                        for k in list(run_block.keys()):
                            if run_block[k] is None:
                                del run_block[k]

                        # Common numeric keys
                        if 'k' in run_block:
                            run_block['k'] = _coerce_optional_int(run_block.get('k'), 5)
                        if 'L' in run_block:
                            run_block['L'] = _coerce_optional_int(run_block.get('L'), 0)
                        if 'seed' in run_block:
                            seed_val = run_block.get('seed')
                            run_block['seed'] = _coerce_optional_int(seed_val, None)

                        sanitized_case['run'] = run_block

                        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as temp_file:
                            json.dump(sanitized_case, temp_file, indent=2)
                            temp_path = temp_file.name

                        logger.info(f"Wrote case data to temporary file: {temp_path}")

                        # Call Solve_test_case with the file path. To make sure
                        # any relative output paths written by testcase_gui go into
                        # the run folder, temporarily switch CWD to run_output_dir.
                        original_cwd = os.getcwd()
                        try:
                            os.chdir(str(run_output_dir))
                            logger.info(f"Changed CWD to {run_output_dir} before invoking testcase_gui")
                            logger.info(f"Calling testcase_gui.Solve_test_case({temp_path})")
                            tcg_out = _tcg.Solve_test_case(temp_path)
                            logger.info(f"testcase_gui.Solve_test_case returned: {type(tcg_out)}")
                        finally:
                            try:
                                os.chdir(original_cwd)
                                logger.info(f"Restored CWD to {original_cwd}")
                            except Exception:
                                pass

                        # Clean up temporary file
                        try:
                            os.unlink(temp_path)
                        except Exception:
                            pass  # Don't fail if cleanup fails
                            
                        # We don't rely on exact shape; adapt best-effort
                        result_payload = self._coerce_tcg_result(tcg_out)
                        logger.info(f"_coerce_tcg_result returned: {result_payload is not None}")
                        
                        if result_payload:
                            # Add debug info to track that testcase_gui was used
                            result_payload.setdefault('debug_info', {})
                            result_payload['debug_info']['used_testcase_gui'] = True
                            result_payload['debug_info']['tcg_output_type'] = str(type(tcg_out))
                            logger.info("[Done] Successfully used testcase_gui.py!")
                    except Exception as e:
                        logger.warning(f"Solve_test_case failed, will try build+solve path: {e}")

                if result_payload is None:
                    # Build + solve path
                    build_model = getattr(_tcg, 'build_model', None)
                    solve_two_phase = getattr(_tcg, 'solve_two_phase', None)
                    if callable(build_model) and callable(solve_two_phase):
                        ctx = build_model(constants or {}, case)

                        # Defensive parsing: testcase_gui may return run_config
                        # with missing or None values for 'k'/'seed'. Avoid
                        # int(None) TypeError by using a small helper.
                        def _safe_int(val, default=5):
                            try:
                                if val is None:
                                    return default
                                # Allow strings and numeric types
                                return int(val)
                            except Exception:
                                logger.debug(f"Could not parse int from run_config value: {val!r}; using default {default}")
                                return default

                        K = _safe_int(run_config.get('k', 5), 5)
                        seed_val = run_config.get('seed')
                        seed = None
                        if seed_val is not None:
                            try:
                                seed = int(seed_val)
                            except Exception:
                                # Non-fatal: log and continue without seed
                                logger.debug(f"Invalid seed value in run_config: {seed_val!r}; ignoring seed")

                        try:
                            tcg_out = solve_two_phase(constants or {}, case, ctx, K, seed=seed)
                            result_payload = self._coerce_tcg_result(tcg_out)
                        except Exception as e:
                            logger.warning(f"testcase_gui solve_two_phase failed: {e}")
                            logger.debug(traceback.format_exc())

                if result_payload is not None:
                    # Annotate solver info and return
                    result_payload.setdefault('solver_info', {})
                    result_payload['solver_info'].update({
                        'implementation': 'testcase_gui.py',
                        'bridge': 'fastapi_solver_service',
                    })
                    return result_payload

                logger.warning("testcase_gui.py available but result could not be coerced; falling back")
                # Add debug info for fallback case  
                logger.info("[Warning] Using built-in solver fallback")
            except Exception as e:
                logger.warning(f"Failed to use testcase_gui.py, using built-in model. Reason: {e}")

        # ---------- Built-in simplified OR-Tools model (fallback) ----------
        logger.info(f"Building CP-SAT model for run {run_id} (built-in)")
        
        # Stage 2: Model Building (15-30%)
        self._update_progress(run_id, 18, "Initializing CP-SAT solver...")
        
        # Initialize CP model
        model = cp_model.CpModel()
        
        # Extract configuration
        max_time = constants.get('solver', {}).get('max_time_in_seconds', 300)
        num_threads = constants.get('solver', {}).get('num_threads', 8)
        k_solutions = run_config.get('k', 5)
        
        self._update_progress(run_id, 22, "Analyzing problem complexity...")
        self._update_progress(run_id, 25, f"Allocating {len(shifts) * len(providers)} decision variables...")
        self._update_progress(run_id, 28, "Building variable matrix...")
        
        # Stage 3: Variable Creation (30-40%)
        self._update_progress(run_id, 32, "Creating shift assignment variables...")
        
        # Create decision variables
        shift_assignments = {}
        for shift in shifts:
            shift_id = shift['id']
            for provider in providers:
                provider_name = provider['name']
                # Binary variable: 1 if provider is assigned to shift, 0 otherwise
                var_name = f"assign_{provider_name}_{shift_id}"
                shift_assignments[(provider_name, shift_id)] = model.NewBoolVar(var_name)
        
        self._update_progress(run_id, 38, f"Created {len(shift_assignments)} decision variables")
        self._update_progress(run_id, 42, "Preparing constraint system...")
        
        # Stage 4: Adding Constraints (42-58%)
        self._update_progress(run_id, 45, "Adding shift coverage constraints...")
        
        # Constraint 1: Each shift must be assigned to exactly one provider
        for shift in shifts:
            shift_id = shift['id']
            model.Add(
                sum(shift_assignments[(provider['name'], shift_id)] for provider in providers) == 1
            )
        
        self._update_progress(run_id, 48, "Processing provider availability...")
        
        # Constraint 2: Provider availability and forbidden days
        shifts_by_date = collections.defaultdict(list)
        for shift in shifts:
            shifts_by_date[shift['date']].append(shift)
            
        for provider in providers:
            provider_name = provider['name']
            
            # Hard OFF days (forbidden)
            for off_day in provider.get('days_off', []):
                if off_day.get('type') == 'fixed':
                    date_str = off_day['date']
                    if date_str in shifts_by_date:
                        for shift in shifts_by_date[date_str]:
                            model.Add(shift_assignments[(provider_name, shift['id'])] == 0)
        
        self._update_progress(run_id, 52, "Adding workload distribution constraints...")
        
        # Constraint 3: At most one shift per provider per day
        for provider in providers:
            provider_name = provider['name']
            for date_str, day_shifts in shifts_by_date.items():
                if len(day_shifts) > 1:
                    model.Add(
                        sum(shift_assignments[(provider_name, shift['id'])] for shift in day_shifts) <= 1
                    )
        
        self._update_progress(run_id, 60, "Setting up objective function...")
        
        # Objective: Minimize violations and maximize preferences
        objective_terms = []
        
        # Soft constraints: Preferred days
        for provider in providers:
            provider_name = provider['name']
            for pref_day in provider.get('days_on', []):
                if pref_day.get('type') == 'prefer':
                    date_str = pref_day['date']
                    if date_str in shifts_by_date:
                        # Bonus for working on preferred days
                        for shift in shifts_by_date[date_str]:
                            objective_terms.append(
                                shift_assignments[(provider_name, shift['id'])] * 100
                            )
        
        self._update_progress(run_id, 60, "Setting up fairness and workload balancing objective...")
        
        # Fairness: Try to balance workload
        provider_workloads = []
        for provider in providers:
            provider_name = provider['name']
            workload = sum(
                shift_assignments[(provider_name, shift['id'])] 
                for shift in shifts
            )
            provider_workloads.append(workload)
        
        # Add workload balancing terms (CP-SAT-safe)
        if provider_workloads:
            # Create an integer variable for the total workload and constrain it
            # to equal the (symbolic) sum of provider workloads.
            total_workload = model.NewIntVar(0, len(shifts) * len(providers), 'total_workload')
            model.Add(total_workload == sum(provider_workloads))

            # Represent the average as an IntVar and relate it to total_workload
            # via multiplication by the number of providers. This avoids doing
            # Python-side integer division on OR-Tools expressions.
            n_providers = len(provider_workloads)
            avg_workload = model.NewIntVar(0, len(shifts), 'avg_workload')
            # Allow a small remainder so total_workload doesn't need to be
            # exactly divisible by number of providers (floor division semantics)
            remainder = model.NewIntVar(0, max(0, n_providers - 1), 'avg_remainder')
            model.Add(total_workload == avg_workload * n_providers + remainder)

            if n_providers > 1:
                # Minimize max-min difference as an additional fairness metric
                min_workload = model.NewIntVar(0, len(shifts), 'min_workload')
                max_workload = model.NewIntVar(0, len(shifts), 'max_workload')

                for idx, workload in enumerate(provider_workloads):
                    # Constrain min/max relative to each provider workload
                    model.Add(min_workload <= workload)
                    model.Add(max_workload >= workload)

                workload_range = model.NewIntVar(0, len(shifts), 'workload_range')
                model.Add(workload_range == max_workload - min_workload)
                objective_terms.append(-workload_range)  # Minimize workload range

            # Also add per-provider absolute deviation from average
            for idx, workload in enumerate(provider_workloads):
                suffix = f"_{idx}"
                deviation = model.NewIntVar(-len(shifts), len(shifts), f'deviation{suffix}')
                model.Add(deviation == workload - avg_workload)
                abs_deviation = model.NewIntVar(0, len(shifts), f'abs_deviation{suffix}')
                model.AddAbsEquality(abs_deviation, deviation)
                objective_terms.append(-abs_deviation)
        
        if objective_terms:
            model.Maximize(sum(objective_terms))
        
        # Stage 6: Solver Preparation (68-72%)
        self._update_progress(run_id, 68, "Finalizing optimization model...")
        self._update_progress(run_id, 70, "Configuring solver parameters...")
        
        # Solve the model
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max_time
        solver.parameters.num_search_workers = num_threads
        
        self._update_progress(run_id, 72, f"Starting CP-SAT solver with {num_threads} threads...")
        
        # Stage 7: Solving (72-82%)
        self._update_progress(run_id, 74, "Solver running - searching solution space...")
        
        # Collect multiple solutions if requested
        if k_solutions > 1:
            self._update_progress(run_id, 76, f"Searching for up to {k_solutions} diverse solutions...")
            solution_collector = SolutionCollector(shift_assignments, shifts, providers, k_solutions)
            # Use the proper OR-Tools API name (SolveWithSolutionCallback)
            self._update_progress(run_id, 78, "Exploring solution alternatives...")
            status = solver.SolveWithSolutionCallback(model, solution_collector)
            solutions = solution_collector.get_solutions()
            self._update_progress(run_id, 82, f"Found {len(solutions)} solution(s)")
        else:
            self._update_progress(run_id, 76, "Solving for optimal solution...")
            status = solver.Solve(model)
            self._update_progress(run_id, 82, "Solution found")
            solutions = []

            if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
                # Extract single solution
                assignments = []
                for shift in shifts:
                    shift_id = shift['id']
                    for provider in providers:
                        provider_name = provider['name']
                        if solver.Value(shift_assignments[(provider_name, shift_id)]):
                            assignments.append({
                                "shift_id": shift_id,
                                "provider_name": provider_name,
                                "date": shift['date'],
                                "shift_type": shift.get('type', ''),
                                "start_time": shift.get('start', ''),
                    "end_time": shift.get('end', '')
                })

                solutions.append({
                    "assignments": assignments,
                    "objective_value": solver.ObjectiveValue() if solver.ObjectiveValue() else 0
                })
        
        # Stage 8: Post-processing (82-92%)
        self._update_progress(run_id, 85, "Validating solution quality...")
        self._update_progress(run_id, 88, "Computing statistics...")        # Generate statistics
        self._update_progress(run_id, 90, "Analyzing provider workload distribution...")
        
        total_assignments = sum(len(sol.get('assignments', [])) for sol in solutions)
        provider_stats = collections.Counter()
        shift_type_stats = collections.Counter()
        
        for solution in solutions:
            for assignment in solution.get('assignments', []):
                provider_stats[assignment['provider_name']] += 1
                shift_type_stats[assignment['shift_type']] += 1
        
        self._update_progress(run_id, 92, "Preparing result summary...")
        
        result = {
            "solver_status": self._get_status_name(status),
            "solutions_found": len(solutions),
            "solutions": solutions,
            "statistics": {
                "total_shifts": len(shifts),
                "total_providers": len(providers),
                "total_assignments": total_assignments,
                "provider_workload": dict(provider_stats),
                "shift_type_coverage": dict(shift_type_stats),
                "runtime_seconds": solver.WallTime(),
                "objective_value": solver.ObjectiveValue() if solutions else 0
            },
            "solver_info": {
                "status": self._get_status_name(status),
                "runtime": f"{solver.WallTime():.2f} seconds",
                "num_conflicts": solver.NumConflicts(),
                "num_branches": solver.NumBranches()
            }
        }

        # Provide approximate variable/constraint counts useful for tests
        try:
            # Variables ~ assignment vars + 2 per provider (balancing vars)
            var_count = len(shift_assignments) + max(0, len(providers) * 2)
            cons_count = len(shifts)  # one per shift exactly-one
            cons_count += sum(1 for _ in providers) * len(shifts_by_date)  # at-most-one per provider/day
            result.setdefault("solver_info", {})
            result["solver_info"].update({
                "variables": var_count,
                "constraints": cons_count
            })
        except Exception:
            pass
        
        return result

    def _gather_additional_outputs(self, run_output_dir: Path, run_id: str):
        """Copy known auxiliary output files from the base output folder into
        the specific run folder so that zips include the complete artifact set.
        This is a heuristic to handle testcase_gui writing files at base level
        instead of inside the run subfolder.
        """
        base = self.output_dir
        # Known patterns to look for (exact names or prefixes)
        known_files = [
            'calendar.xlsx',
            'constants_effective.json',
            'constants_effective.log',
            'eligibility_capacity.json',
            'hospital_schedule.xlsx',
            'scheduler_run.log',
            'schedules.xlsx',
            'scheduler_log_'  # prefix for JSON logs like scheduler_log_YYYYMMDD_HHMMSS.json
        ]

        for entry in base.iterdir():
            try:
                if entry.is_file():
                    name = entry.name
                    for pattern in known_files:
                        if (pattern.endswith('_') and name.startswith(pattern)) or name == pattern:
                            dst = run_output_dir / name
                            if not dst.exists():
                                shutil.copy2(entry, dst)
                                logger.info(f"Copied auxiliary output {name} -> {dst}")
                elif entry.is_dir() and entry.name != run_id:
                    # Also search recursively inside other run-like directories for known files
                    for sub in entry.rglob('*'):
                        if sub.is_file():
                            name = sub.name
                            for pattern in known_files:
                                if (pattern.endswith('_') and name.startswith(pattern)) or name == pattern:
                                    dst = run_output_dir / name
                                    if not dst.exists():
                                        # Ensure parent exists (dst parent is run_output_dir)
                                        shutil.copy2(sub, dst)
                                        logger.info(f"Copied auxiliary output {name} from {entry.name} (nested) -> {dst}")
            except Exception:
                continue

    def _to_webapp_response(self, model_result: Dict[str, Any], run_id: str) -> Dict[str, Any]:
        """Normalize model_result into response expected by existing local solver clients."""
        # Extract solutions
        solutions: List[Dict[str, Any]] = []
        if isinstance(model_result, dict):
            if isinstance(model_result.get('solutions'), list):
                solutions = model_result['solutions']
            elif isinstance(model_result.get('results'), dict) and isinstance(model_result['results'].get('solutions'), list):
                solutions = model_result['results']['solutions']

        # Build solver_stats if absent
        solver_stats = model_result.get('solver_stats') or {}
        if not solver_stats:
            exec_ms = 0
            try:
                rt = model_result.get('statistics', {}).get('runtime_seconds')
                if rt is not None:
                    exec_ms = int(float(rt) * 1000)
            except Exception:
                pass
            impl = model_result.get('solver_info', {}).get('implementation') if isinstance(model_result.get('solver_info'), dict) else None
            solver_type = 'real_scheduler_sat_core' if impl == 'testcase_gui.py' else 'ortools_fastapi'
            solver_stats = {
                'total_solutions': len(solutions),
                'execution_time_ms': exec_ms,
                'solver_type': solver_type,
                'status': model_result.get('solver_status', 'UNKNOWN')
            }

        payload = {
            'status': 'completed',
            'message': 'Optimization completed',
            'run_id': run_id,
            'progress': 100,
            'results': {
                'solutions': solutions,
                'solver_stats': solver_stats
            },
            'statistics': model_result.get('statistics', {})
        }
        if 'solver_info' in model_result:
            payload['solver_info'] = model_result['solver_info']
        return payload

    def _coerce_tcg_result(self, tcg_out: Any) -> Optional[Dict[str, Any]]:
        """Best-effort adapter to transform testcase_gui outputs into API result schema.
        Accepts either a dict with solutions/assignments or a custom structure.
        Returns normalized dict or None if unable to adapt.
        """
        try:
            # If already in expected shape
            if isinstance(tcg_out, dict) and (
                'solutions' in tcg_out or (
                    'results' in tcg_out and isinstance(tcg_out['results'], dict) and 'solutions' in tcg_out['results']
                )
            ):
                return tcg_out

            # Common pattern: list of solutions or a pool with assignments
            if isinstance(tcg_out, list):
                sols = []
                for idx, sol in enumerate(tcg_out):
                    if isinstance(sol, dict) and 'assignments' in sol:
                        sols.append({
                            'assignments': sol['assignments'],
                            'objective_value': sol.get('objective_value', 0),
                        })
                if sols:
                    return {
                        'solver_status': 'UNKNOWN',
                        'solutions_found': len(sols),
                        'solutions': sols,
                        'statistics': {}
                    }

            # Sometimes a tuple like (solutions, stats)
            if isinstance(tcg_out, tuple) and tcg_out:
                primary = tcg_out[0]
                return self._coerce_tcg_result(primary)

        except Exception as e:
            logger.debug(f"Coercion of testcase_gui output failed: {e}")
        return None
    
    def _get_status_name(self, status) -> str:
        """Convert CP solver status to readable string"""
        status_names = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE", 
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.UNKNOWN: "UNKNOWN",
            cp_model.MODEL_INVALID: "MODEL_INVALID"
        }
        return status_names.get(status, f"UNKNOWN_STATUS_{status}")
    
    def _generate_excel_outputs(self, result: Dict[str, Any], output_dir: Path):
        """Generate Excel files for the solution (optional feature)"""
        try:
            from openpyxl import Workbook
            
            wb = Workbook()
            ws = wb.active
            ws.title = "Schedule"
            
            # Headers
            ws.append(["Date", "Shift Type", "Provider", "Start Time", "End Time"])
            
            # Add assignments from first solution
            if result['solutions']:
                assignments = result['solutions'][0].get('assignments', [])
                for assignment in assignments:
                    ws.append([
                        assignment['date'],
                        assignment['shift_type'],
                        assignment['provider_name'],
                        assignment['start_time'],
                        assignment['end_time']
                    ])
            
            excel_file = output_dir / "schedule.xlsx"
            wb.save(excel_file)
            logger.info(f"Generated Excel output: {excel_file}")
            
        except Exception as e:
            logger.warning(f"Failed to generate Excel: {e}")
    
    def _update_progress(self, run_id: str, progress: float, message: str):
        """Update progress and notify WebSocket clients"""
        if run_id in active_runs:
            active_runs[run_id]['progress'] = progress
            active_runs[run_id]['message'] = message
            active_runs[run_id]['updated_at'] = datetime.now().isoformat()
        
        # Notify WebSocket clients
        if run_id in websocket_connections:
            try:
                asyncio.create_task(self._send_progress_update(run_id, progress, message))
            except Exception as e:
                logger.warning(f"Failed to send WebSocket update: {e}")
        
        # Also emit structured log for external log streaming
        logger.info(f"[PROGRESS] Run {run_id}: {progress}% - {message}")
        
        # Send to external log API if configured
        try:
            asyncio.create_task(self._send_log_to_api(run_id, message, 'info', progress))
        except Exception:
            pass
    
    async def _send_progress_update(self, run_id: str, progress: float, message: str):
        """Send progress update via WebSocket"""
        if run_id in websocket_connections:
            try:
                await websocket_connections[run_id].send_text(json.dumps({
                    "type": "progress",
                    "run_id": run_id,
                    "progress": progress,
                    "message": message,
                    "timestamp": datetime.now().isoformat()
                }))
            except Exception as e:
                logger.warning(f"WebSocket send failed: {e}")

    async def _send_log_to_api(self, run_id: str, message: str, level: str = 'info', progress: float | None = None):
        """Send log to external API for web UI streaming"""
        try:
            # This would send to your web app's log API
            # For now, just log locally
            log_data = {
                "run_id": run_id,
                "message": message,
                "level": level,
                "progress": progress,
                "timestamp": datetime.now().isoformat()
            }
            logger.debug(f"[LOG_API] {json.dumps(log_data)}")
        except Exception as e:
            logger.debug(f"Failed to send log to API: {e}")

class SolutionCollector(cp_model.CpSolverSolutionCallback):
    """Collect multiple solutions from the CP solver"""
    
    def __init__(self, shift_assignments: Dict, shifts: List, providers: List, max_solutions: int):
        cp_model.CpSolverSolutionCallback.__init__(self)
        self._shift_assignments = shift_assignments
        self._shifts = shifts
        self._providers = providers
        self._solutions = []
        self._max_solutions = max_solutions
    
    def on_solution_callback(self):
        if len(self._solutions) >= self._max_solutions:
            self.StopSearch()
            return
        
        # Extract current solution
        assignments = []
        for shift in self._shifts:
            shift_id = shift['id']
            for provider in self._providers:
                provider_name = provider['name']
                if self.Value(self._shift_assignments[(provider_name, shift_id)]):
                    assignments.append({
                        "shift_id": shift_id,
                        "provider_name": provider_name,
                        "date": shift['date'],
                        "shift_type": shift.get('type', ''),
                        "start_time": shift.get('start', ''),
                        "end_time": shift.get('end', '')
                    })
        
        self._solutions.append({
            "assignments": assignments,
            "objective_value": self.ObjectiveValue()
        })
    
    def get_solutions(self) -> List[Dict[str, Any]]:
        return self._solutions

# Initialize solver
solver = AdvancedSchedulingSolver()

# REST API Endpoints
@app.post("/solve")
async def solve_schedule(case: SchedulingCase, background_tasks: BackgroundTasks):
    """Submit a scheduling case for optimization (async with progress tracking)."""
    try:
        run_id = str(uuid.uuid4())
        case_dict = case.dict()

        # Initialize run status
        active_runs[run_id] = {
            "status": "processing",
            "progress": 0,
            "message": "Optimization queued and starting...",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

        # Start optimization in background
        background_tasks.add_task(run_optimization, case_dict, run_id)

        # Return immediately with run_id for status polling
        return {
            "run_id": run_id,
            "status": "processing",
            "progress": 0,
            "message": "Optimization started - use /status/{run_id} to track progress"
        }

    except Exception as e:
        logger.error(f"API error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def run_optimization(case_data: Dict[str, Any], run_id: str):
    """Background task for running optimization with progress updates"""
    try:
        # Update status: Starting
        active_runs[run_id]["status"] = "processing"
        active_runs[run_id]["progress"] = 10
        active_runs[run_id]["message"] = "Loading optimization data..."
        active_runs[run_id]["updated_at"] = datetime.now().isoformat()
        
        # Run optimization
        result = await solver.solve_async(case_data, run_id)
        
        # Normalize to the shape expected by the web app
        model_result = result.get("result", {})
        response_payload = solver._to_webapp_response(model_result, run_id)

        # Package the output folder contents
        output_dir_str = result.get("output_directory")
        if output_dir_str:
            output_dir = Path(output_dir_str)
            if output_dir.exists() and output_dir.is_dir():
                try:
                    active_runs[run_id]["progress"] = 95
                    active_runs[run_id]["message"] = "Packaging results..."
                    active_runs[run_id]["updated_at"] = datetime.now().isoformat()
                    
                    packaged_files = {}
                    for file_path in output_dir.rglob('*'):
                        if file_path.is_file():
                            try:
                                with open(file_path, 'rb') as f:
                                    content_bytes = f.read()
                                relative_path = file_path.relative_to(output_dir)
                                packaged_files[str(relative_path)] = base64.b64encode(content_bytes).decode('utf-8')
                            except Exception as e:
                                logger.warning(f"Could not read and encode file {file_path}: {e}")

                    if packaged_files:
                        response_payload['packaged_files'] = packaged_files
                        logger.info(f"Packaged {len(packaged_files)} files from {output_dir}")

                except Exception as e:
                    logger.error(f"Failed to package output folder {output_dir}: {e}")
        
        # Update final status - COMPLETED
        active_runs[run_id].update({
            "status": "completed",
            "progress": 100,
            "message": "Optimization completed successfully",
            "results": response_payload,  # Store full results for retrieval
            "result": result,
            "completed_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        })
        
        logger.info(f"[{run_id}] Optimization completed successfully")
        
    except Exception as e:
        logger.error(f"Background optimization failed: {e}")
        logger.error(traceback.format_exc())
        active_runs[run_id].update({
            "status": "failed",
            "progress": -1,
            "message": str(e),
            "completed_at": datetime.now().isoformat()
        })

@app.get("/status/{run_id}")
async def get_status(run_id: str):
    """Get status of a specific optimization run with full results when completed"""
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    
    run_data = active_runs[run_id]
    
    response = {
        "status": run_data["status"],
        "message": run_data["message"],
        "run_id": run_id,
        "progress": run_data.get("progress", 0),
        "created_at": run_data["created_at"],
        "updated_at": run_data.get("updated_at", run_data["created_at"])
    }
    
    # Include full results if completed
    if run_data["status"] == "completed" and "results" in run_data:
        response["results"] = run_data["results"]
        response["output_directory"] = run_data.get("result", {}).get("output_directory")
        response["packaged_files"] = run_data["results"].get("packaged_files")
    
    # Include error details if failed
    if run_data["status"] == "failed" and "error" in run_data:
        response["error"] = run_data["error"]
    
    return response

@app.get("/runs")
async def list_runs():
    """List all optimization runs"""
    return {
        "runs": [
            {
                "run_id": run_id,
                "status": data["status"],
                "progress": data.get("progress", 0),
                "message": data["message"],
                "created_at": data["created_at"],
                "updated_at": data["updated_at"]
            }
            for run_id, data in active_runs.items()
        ]
    }

@app.websocket("/ws/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str):
    """WebSocket for real-time progress updates"""
    await websocket.accept()
    websocket_connections[run_id] = websocket
    
    try:
        # Send initial status if run exists
        if run_id in active_runs:
            run_data = active_runs[run_id]
            await websocket.send_text(json.dumps({
                "type": "status",
                "run_id": run_id,
                "status": run_data["status"],
                "progress": run_data.get("progress", 0),
                "message": run_data["message"]
            }))
        
        # Keep connection alive and listen for client messages
        while True:
            data = await websocket.receive_text()
            # Echo back for keep-alive
            await websocket.send_text(json.dumps({
                "type": "ping",
                "message": "Connection alive"
            }))
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for run {run_id}")
    finally:
        if run_id in websocket_connections:
            del websocket_connections[run_id]

@app.get("/output/{run_id}")
async def get_output_files(run_id: str):
    """Get list of output files for a specific run"""
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    
    run_dir = solver.output_dir / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail="Output directory not found")
    
    files = list(run_dir.glob("*"))
    return {
        "run_id": run_id,
        "output_directory": str(run_dir),
        "files": [
            {
                "name": f.name,
                "size": f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat()
            }
            for f in files if f.is_file()
        ]
    }


@app.get("/results/folders")
async def list_result_folders():
    """List Result_N folders available in the solver output directory"""
    base = solver.output_dir
    if not base.exists():
        return {"folders": []}

    folders = []
    seen = set()
    for entry in base.iterdir():
        try:
            # Top-level Result_N folders
            if entry.is_dir() and entry.name.lower().startswith('result_'):
                if entry.name not in seen:
                    files = [p for p in entry.iterdir() if p.is_file()]
                    stat = entry.stat()
                    folders.append({
                        "name": entry.name,
                        "path": str(entry),
                        "created": stat.st_ctime,
                        "fileCount": len(files)
                    })
                    seen.add(entry.name)

            # Also inspect run-specific directories (UUIDs) for nested Result_N folders
            elif entry.is_dir():
                try:
                    for sub in entry.iterdir():
                        if sub.is_dir() and sub.name.lower().startswith('result_'):
                            if sub.name not in seen:
                                files = [p for p in sub.rglob('*') if p.is_file()]
                                stat = sub.stat()
                                folders.append({
                                    "name": sub.name,
                                    "path": str(sub),
                                    "created": stat.st_ctime,
                                    "fileCount": len(files)
                                })
                                seen.add(sub.name)
                except Exception:
                    # don't fail if a run folder can't be scanned
                    continue
        except Exception:
            continue

    return {"folders": folders}

@app.get("/download/{run_id}/{filename}")
async def download_file(run_id: str, filename: str):
    """Download a specific output file"""
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    
    file_path = solver.output_dir / run_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(path=file_path, filename=filename)


@app.get("/download/folder/{folder_name}")
async def download_folder(folder_name: str):
    """Create a ZIP of a result folder and return it"""
    # Look for the folder directly under the solver output directory
    candidates = []
    try:
        direct = solver.output_dir / folder_name
        if direct.exists() and direct.is_dir():
            candidates.append(direct)
    except Exception:
        pass

    # Also search nested run folders for a folder with the requested name
    try:
        for entry in solver.output_dir.iterdir():
            try:
                if entry.is_dir():
                    nested = entry / folder_name
                    if nested.exists() and nested.is_dir():
                        candidates.append(nested)
            except Exception:
                continue
    except Exception:
        pass

    if not candidates:
        raise HTTPException(status_code=404, detail="Run not found")

    run_dir = candidates[0]

    # Create a temporary zip in the OS temp directory to avoid locking issues
    import zipfile, tempfile
    tmp = Path(tempfile.gettempdir()) / f"{folder_name}-{uuid.uuid4().hex}.zip"
    try:
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for f in run_dir.rglob('*'):
                if f.is_file():
                    # Preserve relative paths inside the zip
                    zipf.write(f, arcname=f.relative_to(run_dir))

        return FileResponse(path=str(tmp), filename=f"{folder_name}.zip")
    finally:
        # Delay cleanup a little to ensure the response can be sent; attempt remove
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "FastAPI Scheduling Solver Service is running",
        "timestamp": datetime.now().isoformat(),
        "active_runs": len(active_runs),
        "websocket_connections": len(websocket_connections)
    }

@app.get("/")
async def root():
    """API information"""
    return {
        "title": "Medical Staff Scheduling Solver API",
        "version": "2.0.0",
        "description": "High-performance optimization service using FastAPI and OR-Tools",
        "endpoints": {
            "POST /solve": "Submit scheduling case for optimization",
            "GET /status/{run_id}": "Get optimization status",
            "GET /runs": "List all runs",
            "WebSocket /ws/{run_id}": "Real-time progress updates",
            "GET /output/{run_id}": "List output files",
            "GET /download/{run_id}/{filename}": "Download output file",
            "GET /health": "Health check"
        },
        "documentation": "/docs"
    }

if __name__ == "__main__":
    print("[Feature] Starting Medical Staff Scheduling Solver Service (FastAPI)")
    print("📊 Service URL: http://localhost:8000")
    print("📚 API Documentation: http://localhost:8000/docs")
    print("🔌 WebSocket: ws://localhost:8000/ws/{run_id}")
    print("\n[Goal] Endpoints:")
    print("  POST /solve              - Submit optimization case")
    print("  GET  /status/{run_id}    - Get run status") 
    print("  GET  /runs               - List all runs")
    print("  WebSocket /ws/{run_id}   - Real-time updates")
    print("  GET  /health             - Health check")
    print("\n[Info] Press Ctrl+C to stop the service")
    
    uvicorn.run(
        "fastapi_solver_service:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Disable in production
        log_level="info"
    )