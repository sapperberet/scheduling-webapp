/**
 * Real-time Log Streaming API
 * 
 * This endpoint streams solver logs in real-time using Server-Sent Events (SSE)
 * Clients can subscribe to log updates for a specific run ID
 */

import { NextRequest } from 'next/server';

// In-memory log store (in production, use Redis or DynamoDB)
const logStore = new Map<string, string[]>();
const logSubscribers = new Map<string, Set<(log: string) => void>>();

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const runId = params.runId;

  // Set up Server-Sent Events (SSE) headers
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const initialMessage = `data: ${JSON.stringify({ 
        type: 'connected', 
        runId, 
        timestamp: new Date().toISOString() 
      })}\n\n`;
      controller.enqueue(encoder.encode(initialMessage));

      // Send any existing logs for this run
      const existingLogs = logStore.get(runId) || [];
      existingLogs.forEach(log => {
        const message = `data: ${JSON.stringify({ 
          type: 'log', 
          runId, 
          message: log,
          timestamp: new Date().toISOString() 
        })}\n\n`;
        controller.enqueue(encoder.encode(message));
      });

      // Subscribe to new log updates
      const subscriber = (log: string) => {
        const message = `data: ${JSON.stringify({ 
          type: 'log', 
          runId, 
          message: log,
          timestamp: new Date().toISOString() 
        })}\n\n`;
        
        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          // Stream already closed, unsubscribe
          const subscribers = logSubscribers.get(runId);
          if (subscribers) {
            subscribers.delete(subscriber);
          }
        }
      };

      if (!logSubscribers.has(runId)) {
        logSubscribers.set(runId, new Set());
      }
      logSubscribers.get(runId)!.add(subscriber);

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000); // Every 15 seconds

      // Cleanup on close
      return () => {
        clearInterval(heartbeat);
        const subscribers = logSubscribers.get(runId);
        if (subscribers) {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) {
            logSubscribers.delete(runId);
          }
        }
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

// POST endpoint to add logs from solvers
export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const runId = params.runId;
  
  try {
    const body = await request.json();
    const { message, level = 'info' } = body;

    if (!message) {
      return Response.json({ error: 'Message required' }, { status: 400 });
    }

    // Format log with level and timestamp
    const formattedLog = `[${level.toUpperCase()}] ${message}`;

    // Store log
    if (!logStore.has(runId)) {
      logStore.set(runId, []);
    }
    logStore.get(runId)!.push(formattedLog);

    // Notify all subscribers
    const subscribers = logSubscribers.get(runId);
    if (subscribers) {
      subscribers.forEach(subscriber => subscriber(formattedLog));
    }

    return Response.json({ success: true, runId, message: formattedLog });
  } catch (error) {
    console.error('[LOGS] Error adding log:', error);
    return Response.json({ error: 'Failed to add log' }, { status: 500 });
  }
}

// DELETE endpoint to clear logs for a run
export async function DELETE(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const runId = params.runId;
  
  logStore.delete(runId);
  logSubscribers.delete(runId);

  return Response.json({ success: true, runId, message: 'Logs cleared' });
}
