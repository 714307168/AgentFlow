import Store from "electron-store";

export type FieldNodeKind = "standard" | "field_environment" | "remote_machine";

export interface FieldNodeProfile {
  kind: FieldNodeKind;
  displayName: string;
  location: string | null;
  diagnosticsEnabled: boolean;
}

interface FieldNodeSchema {
  profile: FieldNodeProfile;
}

const DEFAULT_PROFILE: FieldNodeProfile = {
  kind: "standard",
  displayName: "",
  location: null,
  diagnosticsEnabled: true,
};

export function normalizeFieldNodeProfile(value: Partial<FieldNodeProfile> | null | undefined): FieldNodeProfile {
  const kind = value?.kind === "field_environment" || value?.kind === "remote_machine"
    ? value.kind
    : "standard";
  return {
    kind,
    displayName: String(value?.displayName ?? "").trim().slice(0, 120),
    location: String(value?.location ?? "").trim().slice(0, 200) || null,
    diagnosticsEnabled: value?.diagnosticsEnabled !== false,
  };
}

class FieldNodeStore {
  private readonly store = new Store<FieldNodeSchema>({
    name: "field-node",
    defaults: { profile: DEFAULT_PROFILE },
  });

  getProfile(): FieldNodeProfile {
    return normalizeFieldNodeProfile(this.store.get("profile"));
  }

  saveProfile(value: Partial<FieldNodeProfile>): FieldNodeProfile {
    const profile = normalizeFieldNodeProfile({ ...this.getProfile(), ...value });
    this.store.set("profile", profile);
    return profile;
  }
}

export default new FieldNodeStore();
