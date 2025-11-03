#!/usr/bin/env python3
"""
Verification Script - Solver Configuration Check
Verifies that all solver files have the correct settings matching the old working solver.
"""

import json
import sys
from pathlib import Path

def check_file(file_path):
    """Check if a testcase_gui.py file has correct settings"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        issues = []
        
        # Check relative_gap
        if '"relative_gap": 0.00001' in content:
            issues.append("❌ relative_gap is 0.00001 (should be 0.0)")
        elif '"relative_gap": 0.0' in content:
            print(f"✓ relative_gap is correct (0.0)")
        else:
            issues.append("⚠️  relative_gap not found or unrecognized format")
        
        # Check soft constraint weights
        if '"cluster": 10000' in content:
            issues.append("❌ cluster weight is 10000 (should be 1000)")
        elif '"cluster": 1000' in content:
            print(f"✓ cluster weight is correct (1000)")
        else:
            issues.append("⚠️  cluster weight not found")
        
        if '"requested_off": 10000000' in content:
            issues.append("❌ requested_off is 10000000 (should be 1000000)")
        elif '"requested_off": 1000000' in content:
            print(f"✓ requested_off weight is correct (1000000)")
        else:
            issues.append("⚠️  requested_off not found")
        
        if '"days_wanted_not_met": 10000000' in content:
            issues.append("❌ days_wanted_not_met is 10000000 (should be 1000000)")
        elif '"days_wanted_not_met": 1000000' in content:
            print(f"✓ days_wanted_not_met weight is correct (1000000)")
        else:
            issues.append("⚠️  days_wanted_not_met not found")
        
        if '"cluster_weekend_start": 10000000' in content:
            issues.append("❌ cluster_weekend_start is 10000000 (should be 1000000)")
        elif '"cluster_weekend_start": 1000000' in content:
            print(f"✓ cluster_weekend_start weight is correct (1000000)")
        else:
            issues.append("⚠️  cluster_weekend_start not found")
        
        # Check for diagnosis call
        if 'run_diag(' in content and 'hospital_schedule' in content:
            print(f"✓ Diagnosis generation is present")
        else:
            issues.append("⚠️  Diagnosis generation (run_diag) may be missing")
        
        # Check for results.json generation
        if 'results.json' in content:
            print(f"✓ results.json generation is present")
        else:
            issues.append("⚠️  results.json generation may be missing")
        
        # Check for input_case.json generation
        if 'input_case.json' in content:
            print(f"✓ input_case.json generation is present")
        else:
            issues.append("⚠️  input_case.json generation may be missing")
        
        return issues
    
    except Exception as e:
        return [f"❌ Error reading file: {e}"]

def main():
    files_to_check = [
        Path(r"c:\Werk\Webapp\Webapp7aramoy\scheduling-webapp\testcase_gui.py"),
        Path(r"c:\Werk\Webapp\lambda_layer\python\testcase_gui.py"),
        Path(r"c:\Werk\Webapp\testcase_gui.py"),
    ]
    
    print("=" * 70)
    print("SOLVER CONFIGURATION VERIFICATION")
    print("=" * 70)
    print()
    
    all_good = True
    
    for file_path in files_to_check:
        print(f"\nChecking: {file_path}")
        print("-" * 70)
        
        if not file_path.exists():
            print(f"⚠️  File not found: {file_path}")
            continue
        
        issues = check_file(file_path)
        
        if issues:
            all_good = False
            print("\nISSUES FOUND:")
            for issue in issues:
                print(f"  {issue}")
        else:
            print("\n✅ All checks passed!")
    
    print("\n" + "=" * 70)
    if all_good:
        print("🎉 ALL FILES ARE CORRECTLY CONFIGURED!")
        print("=" * 70)
        return 0
    else:
        print("⚠️  SOME FILES NEED ATTENTION")
        print("=" * 70)
        return 1

if __name__ == "__main__":
    sys.exit(main())
