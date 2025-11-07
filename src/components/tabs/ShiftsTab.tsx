'use client';

import { useState } from 'react';
import { useScheduling } from '@/context/SchedulingContext';
import { Shift, DEFAULT_SHIFT_TYPES } from '@/types/scheduling';
import { formatTime, formatDate } from '@/lib/scheduling';
import { 
  IoCalendarSharp,
  IoTimeSharp,
  IoStatsChartSharp
} from 'react-icons/io5';
import SchedulingCalendar from '@/components/SchedulingCalendar';

// function getCorrectedEndDateString(dateStr: string, startTime: string, endTime: string): string {
//   // If end time is on the next day (e.g., 20:00 to 08:00)
//   if (endTime <= startTime) {
//     // Create a date object safely from YYYY-MM-DD to avoid timezone issues
//     const [year, month, day] = dateStr.split('-').map(Number);
//     const date = new Date(year, month - 1, day);
    
//     // Increment the day by one
//     date.setDate(date.getDate() + 1);
    
//     // Format back to YYYY-MM-DD
//     const nextYear = date.getFullYear();
//     const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
//     const nextDay = String(date.getDate()).padStart(2, '0');
    
//     return `${nextYear}-${nextMonth}-${nextDay}`;
//   }
//   // Otherwise, the end date is the same as the start date
//   return dateStr;
// }
function formatToLocalISO(date: Date): string {
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
         `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default function ShiftsTab() {
  const { state, dispatch } = useScheduling();
  const { case: schedulingCase, selectedDate } = state;
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  // const [selectedShiftIndex, setSelectedShiftIndex] = useState<number | null>(null);
  const [shiftForm, setShiftForm] = useState<Partial<Shift>>({
    id: '',
    type: '',
    start: '',
    end: '',
    date: selectedDate || '',
    allowed_provider_types: [],
  });
  // Store the raw text for the provider types textarea to allow editing
  const [providerTypesText, setProviderTypesText] = useState<string>('');
  // Default to false to avoid accidentally adding a shift across many days
  const [addToAllDays, setAddToAllDays] = useState(false);

  const shiftsForSelectedDate = selectedDate
    ? schedulingCase.shifts.filter(shift => shift.date === selectedDate)
    : schedulingCase.shifts;

  const handleDateSelect = (date: string) => {
    dispatch({ type: 'SELECT_DATE', payload: date });
    setShiftForm(prev => ({ ...prev, date }));
  };

  const todayIso = new Date().toISOString().split('T')[0];

  const handleShiftSelect = (shift: Shift) => {
    setSelectedShiftId(shift.id!); // Store the unique ID
    const providers = shift.allowed_provider_types || [];
    setShiftForm({
      ...shift,
      start: formatTime(shift.start),
      end: formatTime(shift.end),
      allowed_provider_types: providers,
    });
    // Set the text version for editing
    setProviderTypesText(providers.join(', '));
  };

  const handleShiftFormChange = (field: keyof Shift, value: string | string[] | null) => {
    setShiftForm(prev => ({ ...prev, [field]: value }));
  };

  const generateShiftId = (date: string, type: string) => {
    return `${date}_${type}`;
  };

const addShift = () => {
   if (!shiftForm.type || !shiftForm.start || !shiftForm.end) { // Ensure end time is also present
      alert('Please fill in all required fields (type, start time, and end time)');
      return;
    }
    
   
    const date = shiftForm.date || selectedDate || schedulingCase.calendar.days[0];
    if (!date) {
      alert('Please select a date or generate calendar days first');
      return;
    }
    
    // When adding across "month", only include calendar days that fall in the
    // same month and year as the chosen date. This prevents unintentionally
    // spanning multiple months when the calendar contains days from other months.
     const dateRange = addToAllDays
      ? schedulingCase.calendar.days.filter((d) => {
          try {
            const candidate = new Date(d);
            const base = new Date(date);
            return (
              candidate.getFullYear() === base.getFullYear() &&
              candidate.getMonth() === base.getMonth()
            );
          } catch {
            return false;
          }
        })
      : [date];
    
        dateRange.forEach((currentDate) => {
      const initialStartDate = new Date(`${currentDate}T${shiftForm.start!}:00`);
      // Initially, create the end date on the same day as the start date
      const finalEndDate = new Date(`${currentDate}T${shiftForm.end!}:00`);

      // If the end time is on or before the start time, it's an overnight shift.
      // Add one day to the end date.
      if (finalEndDate <= initialStartDate) {
        finalEndDate.setDate(finalEndDate.getDate() + 1);
      }

      const newShift: Shift = {
        id: generateShiftId(currentDate, shiftForm.type!),
        date: currentDate, // The 'date' of a shift is always its start date
        type: shiftForm.type!,
        start: formatToLocalISO(initialStartDate), // FIX: Use new helper function
        end: formatToLocalISO(finalEndDate),       // FIX: Use new helper function
        allowed_provider_types: shiftForm.allowed_provider_types || [],
      };
      dispatch({ type: 'ADD_SHIFT', payload: newShift });
    });

    // Reset form
    setShiftForm({
      id: '',
      type: '',
      start: '',
      end: '',
      date: selectedDate || '',
      allowed_provider_types: [],
    });
    setProviderTypesText('');
  };

  const updateShift = () => {
    if (!selectedShiftId || !shiftForm.type || !shiftForm.date || !shiftForm.start || !shiftForm.end) return;

    // Logic to update across the entire month
    if (addToAllDays) {
      if (
        !window.confirm(
          `Are you sure you want to update all "${shiftForm.type}" shifts for this month?`
        )
      ) {
        return;
      }

      const baseDate = new Date(shiftForm.date);
      const targetYear = baseDate.getFullYear();
      const targetMonth = baseDate.getMonth();

      // Find all shifts of the same type in the same month/year
      const shiftsToUpdate = schedulingCase.shifts.filter((shift) => {
        try {
          const shiftDate = new Date(shift.date);
          return (
            shift.type === shiftForm.type &&
            shiftDate.getFullYear() === targetYear &&
            shiftDate.getMonth() === targetMonth
          );
        } catch {
          return false;
        }
      });

      // Dispatch an update for each matching shift
           shiftsToUpdate.forEach((shift) => {
        const initialStartDate = new Date(`${shift.date}T${shiftForm.start!}:00`);
        const finalEndDate = new Date(`${shift.date}T${shiftForm.end!}:00`);

        if (finalEndDate <= initialStartDate) {
            finalEndDate.setDate(finalEndDate.getDate() + 1);
        }
        
        const updatedShift: Shift = {
          ...shift,
          type: shiftForm.type!,
          start: formatToLocalISO(initialStartDate), // FIX: Use new helper function
          end: formatToLocalISO(finalEndDate),       // FIX: Use new helper function
          allowed_provider_types: shiftForm.allowed_provider_types || [],
        };
        dispatch({
          type: 'UPDATE_SHIFT',
          payload: { id: shift.id!, shift: updatedShift },
        });
      });
    } else {
      // Logic for updating a single shift
      const initialStartDate = new Date(`${shiftForm.date}T${shiftForm.start!}:00`);
      const finalEndDate = new Date(`${shiftForm.date}T${shiftForm.end!}:00`);

      if (finalEndDate <= initialStartDate) {
        finalEndDate.setDate(finalEndDate.getDate() + 1);
      }
      
      const updatedShift: Shift = {
        id: selectedShiftId,
        date: shiftForm.date!,
        type: shiftForm.type!,
        start: formatToLocalISO(initialStartDate), // FIX: Use new helper function
        end: formatToLocalISO(finalEndDate),       // FIX: Use new helper function
        allowed_provider_types: shiftForm.allowed_provider_types || [],
      };
      dispatch({
        type: 'UPDATE_SHIFT',
        payload: { id: selectedShiftId, shift: updatedShift },
      });
    }

    // Reset form
    setSelectedShiftId(null);
    setShiftForm({
      id: '',
      type: '',
      start: '',
      end: '',
      date: selectedDate || '',
      allowed_provider_types: [],
    });
    setProviderTypesText('');
  };

  const deleteShift = () => {
    if (!selectedShiftId || !shiftForm.type || !shiftForm.date) return;

    // Logic to delete across the entire month
    if (addToAllDays) {
      if (
        !window.confirm(
          `Are you sure you want to delete all "${shiftForm.type}" shifts for this month?`
        )
      ) {
        return;
      }
      
      const baseDate = new Date(shiftForm.date);
      const targetYear = baseDate.getFullYear();
      const targetMonth = baseDate.getMonth();

      // Find all shifts of the same type in the same month/year
      const shiftsToDelete = schedulingCase.shifts.filter((shift) => {
        try {
          const shiftDate = new Date(shift.date);
          return (
            shift.type === shiftForm.type &&
            shiftDate.getFullYear() === targetYear &&
            shiftDate.getMonth() === targetMonth
          );
        } catch {
          return false;
        }
      });

      // Dispatch a delete action for each matching shift
      shiftsToDelete.forEach((shift) => {
        dispatch({ type: 'DELETE_SHIFT', payload: shift.id! });
      });
    } else {
      // Original logic for deleting a single shift
      dispatch({ type: 'DELETE_SHIFT', payload: selectedShiftId });
    }

    // Reset form
    setSelectedShiftId(null);
    setShiftForm({
      id: '',
      type: '',
      start: '',
      end: '',
      date: selectedDate || '',
      allowed_provider_types: [],
    });
    setProviderTypesText('');
  };


  const applyShiftTemplate = (template: typeof DEFAULT_SHIFT_TYPES[0]) => {
    setShiftForm(prev => ({
      ...prev,
      type: template.id,
      start: template.startTime,
      end: template.endTime,
      allowed_provider_types: template.allowedProviderTypes,
    }));
    setProviderTypesText(template.allowedProviderTypes.join(', '));
  };


  return (
    <div className="space-y-4 lg:space-y-8 animate-fade-in-up">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8">
        {/* Date Selection */}
        <div className="lg:col-span-1">
          <SchedulingCalendar
            availableDays={schedulingCase.calendar.days}
            selectedDays={selectedDate ? [selectedDate] : []}
            onDayToggle={() => {}} // Not used in single mode
            onDaySelect={handleDateSelect}
            mode="single"
            className="h-auto lg:h-120"
            minDate={todayIso}
          />
        </div>

        {/* Shifts List */}
        <div className="lg:col-span-1">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-8 hover-glow">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-blue-500 rounded-lg flex items-center justify-center">
                <IoTimeSharp className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gradient">
                Shifts {selectedDate ? `for ${formatDate(selectedDate)}` : '(All)'}
              </h3>
            </div>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {shiftsForSelectedDate.map((shift) => (
                <div
                  key={shift.id}
                  onClick={() => handleShiftSelect(shift)}
                  className={`p-4 rounded-xl cursor-pointer transition-all duration-200 ${
                    selectedShiftId === shift.id 
                      ? 'bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-300 dark:border-blue-600 shadow-lg scale-105'
                      : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 hover:shadow-md hover:scale-102'
                  }`}
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">{shift.type}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {formatTime(shift.start)} - {formatTime(shift.end)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-500">ID: {shift.id}</div>
                </div>
              ))}
              {shiftsForSelectedDate.length === 0 && (
                <div className="text-center py-8">
                  <div className="text-gray-400 text-4xl mb-2 flex justify-center">
                    <IoTimeSharp className="w-10 h-10" />
                  </div>
                  <div className="text-gray-500 text-sm font-medium">
                    No shifts for this date
                  </div>
                  <div className="text-gray-400 text-xs mt-1">
                    Add some shifts below
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Shift Editor */}
        <div className="lg:col-span-1">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-8 hover-glow">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <IoStatsChartSharp className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gradient">Shift Editor</h3>
            </div>
            
            {/* Quick Templates */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Quick Templates
              </label>
              <div className="grid grid-cols-2 gap-2">
                {DEFAULT_SHIFT_TYPES.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => applyShiftTemplate(template)}
                    className="px-3 py-2 text-xs bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-600 dark:hover:from-gray-600 dark:hover:to-gray-500 text-gray-800 dark:text-gray-200 rounded-lg transition-all duration-200 font-medium hover:scale-105 shadow-sm"
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Shift ID
                </label>
                <input
                  type="text"
                  value={shiftForm.id || ''}
                  onChange={(e) => handleShiftFormChange('id', e.target.value)}
                  placeholder="Auto-generated if empty"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Type *
                </label>
                <input
                  type="text"
                  value={shiftForm.type || ''}
                  onChange={(e) => handleShiftFormChange('type', e.target.value)}
                  placeholder="e.g., MD_D, MD_N"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Start Time (HH:MM) *
                </label>
                <input
                  type="time"
                  value={shiftForm.start || ''}
                  onChange={(e) => handleShiftFormChange('start', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  End Time (HH:MM) *
                </label>
                <input
                  type="time"
                  value={shiftForm.end || ''}
                  onChange={(e) => handleShiftFormChange('end', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Allowed Provider Types (comma-separated)
                </label>
                <textarea
                  value={providerTypesText}
                  onChange={(e) => {
                    const input = e.target.value;
                    // Update the display text
                    setProviderTypesText(input);
                    // Update the array version for saving
                    const providers = input
                      .split(',')
                      .map(s => s.trim())
                      .filter(s => s.length > 0);
                    handleShiftFormChange('allowed_provider_types', providers);
                  }}
                  onBlur={() => {
                    // When user leaves the field, clean up the text to match the saved array
                    const providers = (shiftForm.allowed_provider_types || []);
                    setProviderTypesText(providers.join(', '));
                  }}
                  placeholder="MD, NP, PA"
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-md resize-none"
                  spellCheck="false"
                  autoComplete="off"
                />
                
                {/* Quick add provider buttons */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {['MD', 'NP', 'PA', 'RN', 'LPN', 'PHARM'].map((provider) => (
                    <button
                      key={provider}
                      onClick={() => {
                        const current = shiftForm.allowed_provider_types || [];
                        if (!current.includes(provider)) {
                          const updated = [...current, provider];
                          handleShiftFormChange('allowed_provider_types', updated);
                          setProviderTypesText(updated.join(', '));
                        }
                      }}
                      className={`px-3 py-1 text-xs rounded-lg transition-all duration-200 ${
                        (shiftForm.allowed_provider_types || []).includes(provider)
                          ? 'bg-blue-500 text-white shadow-md'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                    >
                      {provider}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="apply-across-month" // Changed ID
                  checked={addToAllDays}
                  onChange={(e) => setAddToAllDays(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-white border-gray-300 rounded dark:bg-gray-800 dark:border-gray-600 focus:ring-blue-500"
                />
                <label htmlFor="apply-across-month" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Apply to entire month {/* Changed Label Text */}
                </label>
              </div>

              <div className="flex space-x-2 pt-4">
                <button
                  onClick={addShift}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transform hover:scale-[1.02] transition-all duration-200 font-medium shadow-lg"
                >
                  Add
                </button>
                {selectedShiftId !== null && (
                  <>
                    <button
                      onClick={updateShift}
                      className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transform hover:scale-[1.02] transition-all duration-200 font-medium shadow-lg"
                    >
                      Update
                    </button>
                    <button
                      onClick={deleteShift}
                      className="flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-lg hover:from-red-600 hover:to-pink-700 transform hover:scale-[1.02] transition-all duration-200 font-medium shadow-lg"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>

              {/* Removed test-only button */}
            </div>
          </div>
        </div>
      </div>

      {/* Shift Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl shadow-lg border border-blue-200/50 dark:border-blue-800/50 p-6 hover-glow hover:scale-105 transition-all duration-300">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
              <IoTimeSharp className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Total Shifts</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{schedulingCase.shifts.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl shadow-lg border border-green-200/50 dark:border-green-800/50 p-6 hover-glow hover:scale-105 transition-all duration-300">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
              <IoCalendarSharp className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Selected Date</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {shiftsForSelectedDate.length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-xl shadow-lg border border-purple-200/50 dark:border-purple-800/50 p-6 hover-glow hover:scale-105 transition-all duration-300">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <IoTimeSharp className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Shift Types</p>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {new Set(schedulingCase.shifts.map(s => s.type)).size}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 rounded-xl shadow-lg border border-orange-200/50 dark:border-orange-800/50 p-6 hover-glow hover:scale-105 transition-all duration-300">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <IoStatsChartSharp className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Selected</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                {selectedShiftId !== null ? 1 : 0}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
