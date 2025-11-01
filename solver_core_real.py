#!/usr/bin/env python3
"""
Solver Core - REAL Lambda-Compatible Scheduling Solver
========================================================

This module wraps the REAL testcase_gui.Solve_test_case() function
for use in AWS Lambda (headless environment).

It extracts and calls the pure solver logic WITHOUT the GUI dependencies.

Key function:
- Solve_test_case_lambda(case_file_path) -> (tables, meta)
  This directly calls testcase_gui.Solve_test_case() and captures all output files.
"""

import json
import os
import sys
import logging
import tempfile
from datetime import datetime
from typing import Dict, Any, List, Tuple
import shutil
import glob

# Configure logging to ensure output is visible
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    force=True
)
logger = logging.getLogger("solver-core-real")
logger.setLevel(logging.INFO)

def Solve_test_case_lambda(case_file_path: str) -> Tuple[List[Dict], Dict[str, Any]]:
    """
    Lambda-compatible solver - wraps the REAL testcase_gui.Solve_test_case()
    
    This function:
    1. Imports testcase_gui (handles tkinter gracefully)
    2. Calls testcase_gui.Solve_test_case(case_file_path)
    3. Captures all output files from the 'out' directory
    4. Returns tables and metadata
    
    Args:
        case_file_path: Path to case JSON file
    
    Returns:
        tables: List of solution tables from solver
        meta: Metadata including output_dir with all generated files
    """
    # CRITICAL: This log MUST appear if wrapper is called
    logger.error("!!! WRAPPER FUNCTION CALLED - solver_core_real.Solve_test_case_lambda() !!!")
    print("!!! WRAPPER FUNCTION CALLED - solver_core_real.Solve_test_case_lambda() !!!", flush=True)
    
    logger.info(f"[SOLVER] Starting REAL optimization using testcase_gui.Solve_test_case()")
    logger.info(f"[SOLVER] Case file: {case_file_path}")
    print(f"[SOLVER] Starting REAL optimization using testcase_gui.Solve_test_case()", flush=True)
    print(f"[SOLVER] Case file: {case_file_path}", flush=True)
    
    output_dir = None
    
    try:
        # Create temp working directory for solver output
        work_dir = tempfile.mkdtemp(prefix='solver_work_')
        original_cwd = os.getcwd()
        
        try:
            os.chdir(work_dir)
            logger.info(f"[SOLVER] Working directory: {work_dir}")
            print(f"[SOLVER] Working directory: {work_dir}", flush=True)
            
            # Import the REAL solver from testcase_gui
            # This will import tkinter but won't use it since we're not calling GUI functions
            try:
                import testcase_gui
                logger.info("[SOLVER] Successfully imported testcase_gui module")
            except ImportError as e:
                logger.error(f"[ERROR] Failed to import testcase_gui: {e}")
                raise
            
            # Call the REAL solver
            logger.info("[SOLVER] Calling testcase_gui.Solve_test_case()...")
            print("[SOLVER] Calling testcase_gui.Solve_test_case()...", flush=True)
            tables, meta = testcase_gui.Solve_test_case(case_file_path)
            logger.info(f"[SOLVER] Solver completed. Generated {len(tables)} solution(s)")
            print(f"[SOLVER] Solver completed. Generated {len(tables)} solution(s)", flush=True)
            
            # Check if solver created an 'out' directory or Result_N directories
            logger.info(f"[INFO] Contents of {work_dir}: {os.listdir(work_dir)}")
            print(f"[INFO] Contents of {work_dir}: {os.listdir(work_dir)}", flush=True)
            
            out_path = os.path.join(work_dir, 'out')
            if not os.path.exists(out_path):
                # Check for Result_* directories (solver creates Result_1, Result_2, etc.)
                result_dirs = [d for d in os.listdir(work_dir) if d.startswith('Result_') and os.path.isdir(os.path.join(work_dir, d))]
                if result_dirs:
                    logger.info(f"[SOLVER] Found Result directories: {result_dirs}")
                    # Use working directory to include ALL Result_* directories
                    out_path = work_dir
                    logger.info(f"[SOLVER] Using output path: {out_path} (contains {len(result_dirs)} Result directories)")
                else:
                    logger.warning(f"[WARN] No 'out' or 'Result_*' directory created by solver in {work_dir}")
                    out_path = work_dir  # Use working directory as fallback
            
            # Copy all output files to /tmp/solver_output_*
            output_dir = os.path.join('/tmp', f'solver_output_{int(datetime.utcnow().timestamp() * 1000)}')
            os.makedirs(output_dir, exist_ok=True)
            logger.info(f"[SOLVER] Copying outputs to: {output_dir}")
            
            # Copy all files recursively from out_path to output_dir
            file_count = 0
            for root, dirs, files in os.walk(out_path):
                for file in files:
                    src_file = os.path.join(root, file)
                    # Calculate relative path and preserve structure
                    rel_path = os.path.relpath(src_file, out_path)
                    dst_file = os.path.join(output_dir, rel_path)
                    
                    # Create subdirs if needed
                    os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                    
                    shutil.copy2(src_file, dst_file)
                    file_count += 1
                    logger.info(f"[SOLVER] Copied: {rel_path}")
            
            logger.info(f"[SOLVER] Copied {file_count} files to {output_dir}")
            
            # List all generated files
            all_files = []
            for root, dirs, files in os.walk(output_dir):
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, output_dir)
                    file_size = os.path.getsize(full_path)
                    all_files.append(f"{rel_path} ({file_size} bytes)")
            
            logger.info(f"[SOLVER] Output files:\n" + "\n".join(all_files))
            
            # Add output directory to metadata
            meta['output_dir'] = output_dir
            meta['generated_files'] = file_count
            meta['case_file'] = case_file_path
            
            logger.info(f"[SOLVER] Optimization complete!")
            logger.info(f"[SOLVER] Metadata: {json.dumps(meta, indent=2, default=str)}")
            
            return tables, meta
            
        finally:
            # Clean up working directory
            os.chdir(original_cwd)
            try:
                shutil.rmtree(work_dir)
                logger.info(f"[SOLVER] Cleaned up working directory: {work_dir}")
            except Exception as e:
                logger.warning(f"[WARN] Failed to clean up {work_dir}: {e}")
    
    except Exception as e:
        logger.error(f"[SOLVER ERROR] {type(e).__name__}: {str(e)}")
        import traceback
        logger.error(f"[TRACEBACK]\n{traceback.format_exc()}")
        raise


# Alias for compatibility
Solve_test_case = Solve_test_case_lambda
