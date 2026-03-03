// frontend/app/api/ai/route/route.ts
// Internal AI routing endpoint for BaselineMLB UI and n8n
// POST /api/ai/route

import { NextRequest, NextResponse } from 'next/server';
import { routeAndCallAI } from '@/lib/ai';
import type { TaskDescriptor } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    // Verify internal auth (simple API key check)
    const authHeader = req.headers.get('x-api-key');
    if (authHeader !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { task, user_prompt, prompt_id_override, model_override } = body as {
      task: TaskDescriptor;
      user_prompt: string;
      prompt_id_override?: string;
      model_override?: string;
    };

    if (!task || !user_prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: task, user_prompt' },
        { status: 400 }
      );
    }

    const result = await routeAndCallAI(task, user_prompt, {
      promptIdOverride: prompt_id_override,
      modelOverride: model_override,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI Route]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
