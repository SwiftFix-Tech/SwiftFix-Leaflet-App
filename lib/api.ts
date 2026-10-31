import { supabase, workspace } from "./supabase";
import type { Bounds, Mutation, Road, View } from "./types";
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const api = {
  async view(bounds: Bounds, zoom: number): Promise<View> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const view = await rpc<View & { dataset: string }>("tracker_view", {
        p_workspace: workspace,
        p_bounds: bounds,
        p_zoom: zoom,
      });
      try {
        await Promise.all(
          (["roads", "completed"] as const).map(async (kind) => {
            let page = view[kind].features;
            while (page.length === 750) {
              const next = await rpc<{
                features: Road[];
                revision: number;
                dataset: string;
              }>("tracker_page", {
                p_workspace: workspace,
                p_bounds: bounds,
                p_kind: kind,
                p_dataset: view.dataset,
                p_after: page.at(-1)!.properties.id,
              });
              if (
                next.revision !== view.revision ||
                next.dataset !== view.dataset
              )
                throw new Error("VIEW_CHANGED");
              page = next.features;
              view[kind].features.push(...page);
              if (
                view[kind].features.length > (kind === "roads" ? 12000 : 20000)
              )
                throw new Error(
                  "Too many road sections in view. Zoom in further.",
                );
            }
          }),
        );
        return view;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "VIEW_CHANGED")
          throw error;
      }
    }
    throw new Error("The shared map changed while loading. Please retry.");
  },
  set: (road: Road, completed: boolean, expected?: string) =>
    rpc<Mutation>("set_completed", {
      p_workspace: workspace,
      p_segment: road.properties.id,
      p_completed: completed,
      p_expected: expected ?? null,
    }),
  async membership() {
    if (!supabase) return false;
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspace);
    if (error) throw error;
    return !!data?.length;
  },
};
