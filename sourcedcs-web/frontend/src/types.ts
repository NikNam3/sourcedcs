export interface Event {
  id: string;
  title: string;
  date: string;
  time?: string;
  type: string;
  status: 'planned' | 'active' | 'complete' | 'cancelled';
  description?: string;
  location?: string;
  discordEventId?: string;
}

export interface Squadron {
  id: string;
  name: string;
  designator: string;
  airframe: string;
  role?: string;
  description?: string;
  about?: string;
  image?: string;
  tags?: string[];
  active?: boolean;
  color?: string;
}

export interface RosterEntry {
  id: string;
  name: string;
  displayName?: string;
  roles: string[];
  squadronId?: string;
  avatarUrl?: string;
}

export interface GalleryItem {
  src: string;
  caption?: string;
  idx?: number;
}

export interface HeroImage {
  src: string;
  caption?: string;
}

export interface SkillModule {
  id: string;
  name: string;
  description?: string;
  level?: number;
}

export interface SkillCategory {
  id: string;
  name: string;
  modules: SkillModule[];
}

export interface SkillGrade {
  grade: string;
  gradedBy?: string;
  gradedAt?: string;
  notes?: string;
}

export interface SkillGrades {
  [pilotId: string]: {
    [moduleId: string]: SkillGrade;
  };
}

export interface GradingRequest {
  id: string;
  pilotId: string;
  pilotName: string;
  moduleId: string;
  moduleName: string;
  categoryId?: string;
  requestedAt: string;
  status: 'pending' | 'claimed' | 'graded';
  claimedBy?: string;
  grade?: string;
  notes?: string;
}

export interface FlightPlan {
  id: string;
  submittedBy: string;
  submittedAt: string;
  status?: string;
  callsign?: string;
  aircraftType?: string;
  departure?: string;
  destination?: string;
  alternate?: string;
  departureTime?: string;
  speed?: string;
  altitude?: string;
  route?: string;
  remarks?: string;
  crew?: Array<{ role: string; name: string }>;
  approvedBy?: string;
  approvedAt?: string;
}

export interface Fpl1801Plan {
  id: string;
  submittedBy: string;
  submittedAt: string;
  status?: string;
  aircraftId?: string;
  aircraftType?: string;
  wakeCategory?: string;
  equipment?: string;
  departure?: string;
  departureTime?: string;
  speed?: string;
  level?: string;
  route?: string;
  destination?: string;
  eet?: string;
  alternate?: string;
  alternate2?: string;
  otherInfo?: string;
  endurance?: string;
  personsOnBoard?: string;
  emergencyEquipment?: string;
  pilotName?: string;
  remarks?: string;
}

export interface RuntimeConfig {
  casdoorClientId: string;
  casdoorEndpoint: string;
  discordUrl: string;
  wikiUrl: string;
  atoUrl: string;
  olympusUrl: string;
  asacsUrl: string;
  githubUrl: string;
  skillAdminRoles: string[];
}
