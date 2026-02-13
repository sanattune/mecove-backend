/**
 * Abstract LLM service: swap implementations (e.g. via API vs local) without changing callers.
 */
export interface ILLMService {
  /**
   * Request a completion from the configured model.
   * @returns The generated text (e.g. assistant message content).
   */
  complete(options: CompleteOptions): Promise<string>;
}

export interface CompleteOptions {
  /** User/system prompt or messages. For single prompt, use one item. */
  prompt: string;
  /** Max tokens to generate (optional; model default used if not set). */
  maxTokens?: number;
  /** Complexity level: 'low' | 'medium' | 'high'. Used to select appropriate model. */
  complexity?: 'low' | 'medium' | 'high';
  /** Whether this task requires reasoning capabilities (e.g., deep analysis, pattern recognition). */
  reasoning?: boolean;
}

/** Resolved model entry from config (one provider + one model). */
export interface ResolvedModelConfig {
  provider: string;
  modelName: string;
  apiKey: string;
  maxTokens: number;
}
