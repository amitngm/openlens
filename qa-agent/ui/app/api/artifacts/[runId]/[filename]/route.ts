import { NextRequest, NextResponse } from 'next/server';
import { QA_AGENT_API_URL, errorResponse } from '@/lib/api-client';

/**
 * GET /api/artifacts/[runId]/[filename]
 * Proxy artifact download from QA_AGENT_API_URL/artifacts/{runId}/{filename}
 * 
 * Returns: The artifact file (image, json, etc.)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string; filename: string } }
) {
  try {
    const { runId, filename } = params;
    
    if (!runId || !filename) {
      return errorResponse('Run ID and filename are required', 400);
    }
    
    console.log(`[GET /api/artifacts/${runId}/${filename}]`);
    
    // Forward to backend
    const url = `${QA_AGENT_API_URL}/artifacts/${runId}/${filename}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return errorResponse(
        'Artifact not found',
        response.status
      );
    }
    
    // Get content type from response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    // Stream the response
    const blob = await response.blob();
    
    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
    
  } catch (error) {
    console.error(`[GET /api/artifacts] Error:`, error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse(
        'Cannot connect to QA Agent backend',
        502,
        'Make sure the backend is running'
      );
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
