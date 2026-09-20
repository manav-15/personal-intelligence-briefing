/** Minimal Workflow runtime double used only by Node-based unit tests. */
export class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  protected env!: Env;
  protected params?: Params;

  constructor(_ctx: ExecutionContext, env: Env) {
    this.env = env;
  }
}
