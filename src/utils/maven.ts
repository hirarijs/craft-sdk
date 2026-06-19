export interface MavenArtifact {
  path: string;
  fileName: string;
}

export function getMavenArtifactPath(name: string): MavenArtifact {
  const [group, artifact, version, classifierWithExtension] = name.split(":");
  if (!group || !artifact || !version) {
    throw new Error(`Invalid Maven artifact name: ${name}`);
  }

  let classifier = classifierWithExtension;
  let extension = "jar";
  if (classifierWithExtension?.includes("@")) {
    const [classifierPart, extensionPart] = classifierWithExtension.split("@");
    classifier = classifierPart || undefined;
    extension = extensionPart || extension;
  }

  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ""}.${extension}`;
  return {
    fileName,
    path: `${group.replaceAll(".", "/")}/${artifact}/${version}/${fileName}`,
  };
}
