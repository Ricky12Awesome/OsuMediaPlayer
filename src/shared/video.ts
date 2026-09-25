export const videoPlaysDirectly = (filename: string): boolean =>
  /\.(?:mp4|m4v|webm)$/i.test(filename);
