// Shared CV shapes returned by the API (mirrors server/src/domain/types.ts).

export type DegreeClassValue = 'FIRST' | 'SECOND_UPPER' | 'SECOND_LOWER' | 'THIRD' | 'PASS' | 'NONE';
export type DegreeLevel = 'SSCE' | 'OND' | 'HND' | 'BSC' | 'MSC' | 'PHD';
export type UniversityType = 'FEDERAL' | 'STATE' | 'PRIVATE' | 'POLYTECHNIC' | 'UNKNOWN';

export interface EducationEntry {
  institution: string;
  institutionType?: UniversityType;
  course?: string;
  degreeLevel?: DegreeLevel;
  degreeClass?: DegreeClassValue;
  startYear?: number | null;
  endYear?: number | null;
}

export interface ExperienceEntry {
  title: string;
  organisation?: string;
  startYear?: number | null;
  endYear?: number | null;
  description?: string;
  isInternship?: boolean;
}

export interface ProjectEntry {
  name: string;
  description?: string;
  technologies?: string[];
}

export interface ParsedCV {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  headline?: string | null;
  summary?: string | null;
  skills: string[];
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  certifications: string[];
  languages: string[];
}
