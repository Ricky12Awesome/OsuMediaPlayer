import type { BSON, ObjectSchema } from "realm";

type uuid = BSON.UUID;

export type Beatmap = {
  ID: uuid;
  DifficultyName?: string;
  Ruleset?: Ruleset;
  Difficulty?: BeatmapDifficulty;
  Metadata?: BeatmapMetadata;
  UserSettings?: BeatmapUserSettings;
  BeatmapSet?: BeatmapSet;
  Status: number;
  OnlineID: number;
  Length: number;
  BPM: number;
  Hash?: string;
  StarRating: number;
  MD5Hash?: string;
  OnlineMD5Hash?: string;
  LastLocalUpdate?: Date;
  LastOnlineUpdate?: Date;
  Hidden: boolean;
  EndTimeObjectCount: number;
  TotalObjectCount: number;
  LastPlayed?: Date;
  BeatDivisor: number;
  EditorTimestamp?: number;
};

export const BeatmapSchema: ObjectSchema = {
  name: "Beatmap",
  primaryKey: "ID",
  properties: {
    ID: "uuid",
    DifficultyName: "string?",
    Ruleset: "Ruleset",
    Difficulty: "BeatmapDifficulty",
    Metadata: "BeatmapMetadata",
    UserSettings: "BeatmapUserSettings",
    BeatmapSet: "BeatmapSet",
    Status: "int",
    OnlineID: { type: "int", indexed: true },
    Length: "double",
    BPM: "double",
    Hash: "string?",
    StarRating: "double",
    MD5Hash: { type: "string", optional: true, indexed: true },
    OnlineMD5Hash: "string?",
    LastLocalUpdate: "date?",
    LastOnlineUpdate: "date?",
    Hidden: "bool",
    EndTimeObjectCount: "int",
    TotalObjectCount: "int",
    LastPlayed: "date?",
    BeatDivisor: "int",
    EditorTimestamp: "double?",
  },
};

export type BeatmapCollection = {
  ID: uuid;
  Name?: string;
  BeatmapMD5Hashes: Array<string | undefined>;
  LastModified: Date;
};

export const BeatmapCollectionSchema: ObjectSchema = {
  name: "BeatmapCollection",
  primaryKey: "ID",
  properties: {
    ID: "uuid",
    Name: "string?",
    BeatmapMD5Hashes: "string?[]",
    LastModified: "date",
  },
};

export type BeatmapDifficulty = {
  DrainRate: number;
  CircleSize: number;
  OverallDifficulty: number;
  ApproachRate: number;
  SliderMultiplier: number;
  SliderTickRate: number;
};

export const BeatmapDifficultySchema: ObjectSchema = {
  name: "BeatmapDifficulty",
  embedded: true,
  properties: {
    DrainRate: "float",
    CircleSize: "float",
    OverallDifficulty: "float",
    ApproachRate: "float",
    SliderMultiplier: "double",
    SliderTickRate: "double",
  },
};

export type BeatmapMetadata = {
  Title?: string;
  TitleUnicode?: string;
  Artist?: string;
  ArtistUnicode?: string;
  Author?: RealmUser;
  Source?: string;
  Tags?: string;
  PreviewTime: number;
  AudioFile?: string;
  BackgroundFile?: string;
  UserTags: Array<string | undefined>;
};

export const BeatmapMetadataSchema: ObjectSchema = {
  name: "BeatmapMetadata",
  properties: {
    Title: "string?",
    TitleUnicode: "string?",
    Artist: "string?",
    ArtistUnicode: "string?",
    Author: "RealmUser",
    Source: "string?",
    Tags: "string?",
    PreviewTime: "int",
    AudioFile: "string?",
    BackgroundFile: "string?",
    UserTags: "string?[]",
  },
};

export type BeatmapSet = {
  ID: uuid;
  OnlineID: number;
  DateAdded: Date;
  DateSubmitted?: Date;
  DateRanked?: Date;
  Beatmaps: Array<Beatmap>;
  Files: Array<RealmNamedFileUsage>;
  Status: number;
  DeletePending: boolean;
  Hash?: string;
  Protected: boolean;
};

export const BeatmapSetSchema: ObjectSchema = {
  name: "BeatmapSet",
  primaryKey: "ID",
  properties: {
    ID: "uuid",
    OnlineID: { type: "int", indexed: true },
    DateAdded: "date",
    DateSubmitted: "date?",
    DateRanked: "date?",
    Beatmaps: "Beatmap[]",
    Files: "RealmNamedFileUsage[]",
    Status: "int",
    DeletePending: "bool",
    Hash: "string?",
    Protected: "bool",
  },
};

export type BeatmapUserSettings = {
  Offset: number;
};

export const BeatmapUserSettingsSchema: ObjectSchema = {
  name: "BeatmapUserSettings",
  embedded: true,
  properties: {
    Offset: "double",
  },
};

export type File = {
  Hash?: string;
};

export const FileSchema: ObjectSchema = {
  name: "File",
  primaryKey: "Hash",
  properties: {
    Hash: "string?",
  },
};

export type KeyBinding = {
  ID: uuid;
  RulesetName?: string;
  Variant?: number;
  Action: number;
  KeyCombination?: string;
};

export const KeyBindingSchema: ObjectSchema = {
  name: "KeyBinding",
  primaryKey: "ID",
  properties: {
    ID: "uuid",
    RulesetName: "string?",
    Variant: "int?",
    Action: "int",
    KeyCombination: "string?",
  },
};

export type ModPreset = {
  ID: uuid;
  Ruleset?: Ruleset;
  Name?: string;
  Description?: string;
  Mods?: string;
  DeletePending: boolean;
};

export const ModPresetSchema: ObjectSchema = {
  name: "ModPreset",
  primaryKey: "ID",
  properties: {
    ID: "uuid",
    Ruleset: "Ruleset",
    Name: "string?",
    Description: "string?",
    Mods: "string?",
    DeletePending: "bool",
  },
};

export type RealmNamedFileUsage = {
  File?: File;
  Filename?: string;
};

export const RealmNamedFileUsageSchema: ObjectSchema = {
  name: "RealmNamedFileUsage",
  embedded: true,
  properties: {
    File: "File",
    Filename: "string?",
  },
};

export type RealmOnlineAsset = {
  File?: RealmNamedFileUsage;
  LastAccessed: Date;
};

export const RealmOnlineAssetSchema: ObjectSchema = {
  name: "RealmOnlineAsset",
  properties: {
    File: "RealmNamedFileUsage",
    LastAccessed: { type: "date", indexed: true },
  },
};

export type RealmUser = {
  OnlineID: number;
  Username?: string;
  CountryCode?: string;
};

export const RealmUserSchema: ObjectSchema = {
  name: "RealmUser",
  embedded: true,
  properties: {
    OnlineID: "int",
    Username: "string?",
    CountryCode: "string?",
  },
};

export type Ruleset = {
  ShortName?: string;
  OnlineID: number;
  Name?: string;
  InstantiationInfo?: string;
  LastAppliedDifficultyVersion: number;
  Available: boolean;
};

export const RulesetSchema: ObjectSchema = {
  name: "Ruleset",
  primaryKey: "ShortName",
  properties: {
    ShortName: "string?",
    OnlineID: { type: "int", indexed: true },
    Name: "string?",
    InstantiationInfo: "string?",
    LastAppliedDifficultyVersion: "int",
    Available: "bool",
  },
};

export type RulesetSetting = {
  RulesetName?: string;
  Variant: number;
  Key: string;
  Value: string;
};

export const RulesetSettingSchema: ObjectSchema = {
  name: "RulesetSetting",
  properties: {
    RulesetName: { type: "string", optional: true, indexed: true },
    Variant: { type: "int", indexed: true },
    Key: "string",
    Value: "string",
  },
};

export type Score = {
  ID: uuid;
  BeatmapInfo?: Beatmap;
  ClientVersion?: string;
  BeatmapHash?: string;
  Ruleset?: Ruleset;
  Files: Array<RealmNamedFileUsage>;
  Hash?: string;
  DeletePending: boolean;
  TotalScore: number;
  TotalScoreWithoutMods: number;
  TotalScoreVersion: number;
  LegacyTotalScore?: number;
  BackgroundReprocessingFailed: boolean;
  MaxCombo: number;
  Accuracy: number;
  Date: Date;
  PP?: number;
  OnlineID: number;
  LegacyOnlineID: number;
  User?: RealmUser;
  Mods?: string;
  Statistics?: string;
  MaximumStatistics?: string;
  Rank: number;
  Combo: number;
  IsLegacyScore: boolean;
  Pauses: Array<number>;
};

export const ScoreSchema: ObjectSchema = {
  name: "Score",
  primaryKey: "ID",
  properties: {
    ID: "uuid",
    BeatmapInfo: "Beatmap",
    ClientVersion: "string?",
    BeatmapHash: { type: "string", optional: true, indexed: true },
    Ruleset: "Ruleset",
    Files: "RealmNamedFileUsage[]",
    Hash: "string?",
    DeletePending: "bool",
    TotalScore: "int",
    TotalScoreWithoutMods: "int",
    TotalScoreVersion: "int",
    LegacyTotalScore: "int?",
    BackgroundReprocessingFailed: "bool",
    MaxCombo: "int",
    Accuracy: "double",
    Date: "date",
    PP: "double?",
    OnlineID: { type: "int", indexed: true },
    LegacyOnlineID: { type: "int", indexed: true },
    User: "RealmUser",
    Mods: "string?",
    Statistics: "string?",
    MaximumStatistics: "string?",
    Rank: "int",
    Combo: "int",
    IsLegacyScore: "bool",
    Pauses: "int[]",
  },
};

export type Skin = {
  ID: uuid;
  Name?: string;
  Creator?: string;
  InstantiationInfo?: string;
  Hash?: string;
  Protected: boolean;
  Files: Array<RealmNamedFileUsage>;
  DeletePending: boolean;
};

export const SkinSchema: ObjectSchema = {
  name: "Skin",
  primaryKey: "ID",
  properties: {
    ID: "uuid",
    Name: "string?",
    Creator: "string?",
    InstantiationInfo: "string?",
    Hash: "string?",
    Protected: "bool",
    Files: "RealmNamedFileUsage[]",
    DeletePending: "bool",
  },
};

export const Schema = [
  BeatmapSchema,
  BeatmapCollectionSchema,
  BeatmapDifficultySchema,
  BeatmapMetadataSchema,
  BeatmapSetSchema,
  BeatmapUserSettingsSchema,
  FileSchema,
  KeyBindingSchema,
  ModPresetSchema,
  RealmNamedFileUsageSchema,
  RealmOnlineAssetSchema,
  RealmUserSchema,
  RulesetSchema,
  RulesetSettingSchema,
  ScoreSchema,
  SkinSchema,
];
