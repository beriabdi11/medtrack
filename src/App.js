import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Plus,
  Pill,
  Check,
  Clock,
  User,
  LogOut,
  MapPin,
  Search,
  HeartHandshake,
  Phone
} from 'lucide-react';
import './App.css';

import { auth, db } from './firebase';

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';

import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc
} from 'firebase/firestore';

// ---- Refill defaults (pill counter feature) ----
const DEFAULT_REFILL = {
  pillsRemaining: 30,
  pillsPerDose: 1,
  refillThreshold: 5,
};

const DEFAULT_MEDS = [
  { id: 1, name: 'Lisinopril', dosage: '10mg', time: '08:00', frequency: 'Daily', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], takenLog: {}, ...DEFAULT_REFILL },
  { id: 2, name: 'Metformin', dosage: '500mg', time: '12:00', frequency: 'Daily', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], takenLog: {}, ...DEFAULT_REFILL },
  { id: 3, name: 'Atorvastatin', dosage: '20mg', time: '20:00', frequency: 'Daily', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], takenLog: {}, ...DEFAULT_REFILL },
];

const EMPTY_MED = {
  name: '',
  dosage: '',
  time: '',
  frequency: 'Daily',
  days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  pillsRemaining: 30,
  pillsPerDose: 1,
  refillThreshold: 5,
};

// ---- Caregiver ----
const EMPTY_CAREGIVER = {
  name: '',
  relationship: '',
  phone: '',
  email: '',
  notes: '',
};

const MedTrack = () => {
  const isTest = process.env.NODE_ENV === 'test';

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard');

  // NOTE: tests rely on these placeholders
  const [username, setUsername] = useState(''); // treat as email in Firebase mode
  const [password, setPassword] = useState('');
  const [loggedInUser, setLoggedInUser] = useState('');

  // Auth
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authError, setAuthError] = useState('');

  // Medications
  const [medications, setMedications] = useState(DEFAULT_MEDS);

  // Add/Edit form
  const [newMed, setNewMed] = useState(EMPTY_MED);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Pharmacies (REAL data from Overpass)
  const [pharmacies, setPharmacies] = useState([]);
  const [pharmacyQuery, setPharmacyQuery] = useState('');
  const [userLoc, setUserLoc] = useState(null); // { lat, lng }
  const [locError, setLocError] = useState('');
  const [radiusKm, setRadiusKm] = useState(5); // 1 / 5 / 10
  const [pharmacyStatus, setPharmacyStatus] = useState({ loading: false, error: '' });

  // Preferred pharmacy
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [pharmacyPickStatus, setPharmacyPickStatus] = useState({ loading: false, error: '', saved: '' });

  // Caregiver
  const [caregiver, setCaregiver] = useState(EMPTY_CAREGIVER);
  const [caregiverStatus, setCaregiverStatus] = useState({ loading: false, error: '', saved: '' });

  // ----- Date helpers -----
  const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const isTakenToday = (med) => {
    const key = todayKey();
    return !!med?.takenLog?.[key];
  };

  // current week Monday -> Sunday (YYYY-MM-DD keys)
  const weekDateKeys = () => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun,1=Mon...
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  };

  // ----- Location helpers -----
  const requestLocation = () => {
    setLocError('');
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        setLocError('Geolocation is not supported by this browser.');
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLoc(coords);
          resolve(coords);
        },
        () => {
          setLocError('Location permission denied. Enable it and press Refresh.');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  };

  const toRad = (v) => (v * Math.PI) / 180;

  const milesBetween = (a, b) => {
    const R = 3958.8; // Earth radius in miles
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(x));
  };

  // ----- Overpass (OpenStreetMap) -----
  const fetchPharmaciesFromOverpass = async (lat, lng, radiusKmValue) => {
    const radiusMeters = Math.max(100, Number(radiusKmValue) * 1000);

    const overpassQuery = `
      [out:json][timeout:25];
      (
        node["amenity"="pharmacy"](around:${radiusMeters},${lat},${lng});
        way["amenity"="pharmacy"](around:${radiusMeters},${lat},${lng});
        relation["amenity"="pharmacy"](around:${radiusMeters},${lat},${lng});
      );
      out center tags;
    `;

    const url = 'https://overpass-api.de/api/interpreter';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: overpassQuery }).toString(),
    });

    if (!res.ok) throw new Error(`Overpass error: HTTP ${res.status}`);

    const data = await res.json();
    const elements = data.elements || [];

    const normalized = elements
      .map((el) => {
        const name = el.tags?.name || 'Pharmacy';

        const addressParts = [
          el.tags?.['addr:housenumber'],
          el.tags?.['addr:street'],
          el.tags?.['addr:city'],
          el.tags?.['addr:state'],
          el.tags?.['addr:postcode'],
        ].filter(Boolean);

        const address =
          addressParts.length ? addressParts.join(' ') : (el.tags?.['addr:full'] || '');

        const phone = el.tags?.phone || el.tags?.['contact:phone'] || '';
        const hours = el.tags?.opening_hours || '';

        const latVal = typeof el.lat === 'number' ? el.lat : el.center?.lat;
        const lngVal = typeof el.lon === 'number' ? el.lon : el.center?.lon;

        const osmId = `${el.type}_${el.id}`;

        return {
          id: osmId,
          osmId,
          name,
          address,
          phone,
          hours,
          lat: typeof latVal === 'number' ? latVal : null,
          lng: typeof lngVal === 'number' ? lngVal : null,
          source: 'openstreetmap_overpass',
        };
      })
      .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');

    return normalized;
  };

  const refreshRealPharmacies = async () => {
    setPharmacyStatus({ loading: true, error: '' });

    try {
      const loc = userLoc || await requestLocation();
      if (!loc) {
        setPharmacyStatus({ loading: false, error: 'Enable location to fetch nearby pharmacies.' });
        setPharmacies([]);
        return;
      }

      const results = await fetchPharmaciesFromOverpass(loc.lat, loc.lng, radiusKm);

      if (results.length === 0) {
        setPharmacyStatus({ loading: false, error: 'No pharmacies found in that radius.' });
        setPharmacies([]);
        return;
      }

      setPharmacies(results);
      setPharmacyStatus({ loading: false, error: '' });
    } catch (e) {
      setPharmacyStatus({ loading: false, error: e?.message || 'Failed to fetch pharmacies.' });
      setPharmacies([]);
    }
  };

  const directionsUrlFor = (p) => {
    if (p.address && String(p.address).trim().length > 0) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.address)}`;
    }
    if (typeof p.lat === 'number' && typeof p.lng === 'number') {
      return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    }
    return 'https://www.google.com/maps';
  };

  const normalizePhone = (raw) => String(raw || '').replace(/[^\d+]/g, '');

  const callPhone = (rawPhone) => {
    const phone = normalizePhone(rawPhone);
    if (!phone) return;
    window.location.href = `tel:${phone}`;
  };

  const requestRefill = () => {
    if (!selectedPharmacy?.phone) {
      alert('No pharmacy phone number found. Pick a pharmacy that has a phone listed.');
      return;
    }
    callPhone(selectedPharmacy.phone);
  };

  // ---------- Firebase auth state ----------
  useEffect(() => {
    if (isTest) return;

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setIsLoggedIn(!!u);
      setLoggedInUser(u ? (u.email || '') : '');
      if (!u) {
        setMedications(DEFAULT_MEDS);
        setCurrentView('dashboard');
        setIsEditing(false);
        setEditingId(null);
        setNewMed(EMPTY_MED);

        setCaregiver(EMPTY_CAREGIVER);
        setSelectedPharmacy(null);
      }
    });

    return () => unsub();
  }, [isTest]);

  // ---------- Load meds from Firestore on login ----------
  useEffect(() => {
    if (isTest) return;
    if (!user) return;

    (async () => {
      const medsRef = collection(db, 'users', user.uid, 'medications');
      const qy = query(medsRef, orderBy('time'));
      const snap = await getDocs(qy);

      const normalizeMed = (id, data) => ({
        id,
        ...data,
        takenLog: data.takenLog || {},
        pillsRemaining: typeof data.pillsRemaining === 'number' ? data.pillsRemaining : DEFAULT_REFILL.pillsRemaining,
        pillsPerDose: typeof data.pillsPerDose === 'number' ? data.pillsPerDose : DEFAULT_REFILL.pillsPerDose,
        refillThreshold: typeof data.refillThreshold === 'number' ? data.refillThreshold : DEFAULT_REFILL.refillThreshold,
      });

      if (snap.empty) {
        for (const m of DEFAULT_MEDS) {
          const id = String(m.id);
          await setDoc(doc(db, 'users', user.uid, 'medications', id), {
            name: m.name,
            dosage: m.dosage,
            time: m.time,
            frequency: m.frequency,
            days: m.days,
            takenLog: {},
            pillsRemaining: m.pillsRemaining,
            pillsPerDose: m.pillsPerDose,
            refillThreshold: m.refillThreshold,
          });
        }
        const snap2 = await getDocs(query(medsRef, orderBy('time')));
        setMedications(snap2.docs.map(d => normalizeMed(d.id, d.data())));
      } else {
        setMedications(snap.docs.map(d => normalizeMed(d.id, d.data())));
      }
    })();
  }, [user, isTest]);

  // ---------- Load caregiver + selected pharmacy ----------
  useEffect(() => {
    if (isTest) return;
    if (!user) return;

    (async () => {
      try {
        const cgRef = doc(db, 'users', user.uid, 'caregiver', 'main');
        const spRef = doc(db, 'users', user.uid, 'selectedPharmacy', 'main');

        const cgSnap = await getDocs(query(collection(db, 'users', user.uid, 'caregiver')));
        if (!cgSnap.empty) {
          const d = cgSnap.docs[0].data() || {};
          setCaregiver({
            name: d.name || '',
            relationship: d.relationship || '',
            phone: d.phone || '',
            email: d.email || '',
            notes: d.notes || '',
          });
        }

        const spSnap = await getDocs(query(collection(db, 'users', user.uid, 'selectedPharmacy')));
        if (!spSnap.empty) {
          const d = spSnap.docs[0].data() || {};
          setSelectedPharmacy({
            id: d.id || d.osmId || 'selected',
            osmId: d.osmId || d.id || '',
            name: d.name || '',
            phone: d.phone || '',
            address: d.address || '',
            hours: d.hours || '',
            lat: typeof d.lat === 'number' ? d.lat : null,
            lng: typeof d.lng === 'number' ? d.lng : null,
            source: d.source || 'openstreetmap_overpass',
          });
        }

        // quiet unused vars if lint yells
        void cgRef; void spRef;
      } catch {
        // demo-safe
      }
    })();
  }, [user, isTest]);

  // ---------- Auto-fetch pharmacies when entering page ----------
  useEffect(() => {
    if (isTest) return;
    if (currentView !== 'pharmacies') return;
    refreshRealPharmacies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, isTest]);

  const visiblePharmacies = useMemo(() => {
    const q = pharmacyQuery.trim().toLowerCase();

    let list = pharmacies.filter((p) => {
      if (!q) return true;
      return (
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.address || '').toLowerCase().includes(q)
      );
    });

    if (userLoc) {
      list = list
        .map((p) => ({
          ...p,
          distance:
            (typeof p.lat === 'number' && typeof p.lng === 'number')
              ? milesBetween(userLoc, { lat: p.lat, lng: p.lng })
              : null
        }))
        .sort((a, b) => {
          if (a.distance == null && b.distance == null) return 0;
          if (a.distance == null) return 1;
          if (b.distance == null) return -1;
          return a.distance - b.distance;
        });
    }

    return list;
  }, [pharmacies, pharmacyQuery, userLoc]);

  // ---------- Auth actions ----------
  const handleLogin = async () => {
    setAuthError('');

    if (isTest) {
      if (username && password) {
        setLoggedInUser(username);
        setIsLoggedIn(true);
      }
      return;
    }

    if (!username || !password) return;

    try {
      await signInWithEmailAndPassword(auth, username, password);
    } catch {
      setAuthError('Login failed. Check your email/password.');
    }
  };

  const handleSignup = async () => {
    setAuthError('');
    if (isTest) return;
    if (!username || !password) return;

    try {
      await createUserWithEmailAndPassword(auth, username, password);
    } catch {
      setAuthError('Sign up failed. Try a different email or a stronger password.');
    }
  };

  const handleLogout = async () => {
    setAuthError('');

    if (isTest) {
      setIsLoggedIn(false);
      setUsername('');
      setPassword('');
      setLoggedInUser('');
      setCurrentView('dashboard');
      setMedications(DEFAULT_MEDS);
      setIsEditing(false);
      setEditingId(null);
      setNewMed(EMPTY_MED);
      setCaregiver(EMPTY_CAREGIVER);
      setSelectedPharmacy(null);
      return;
    }

    await signOut(auth);
  };

  // ---------- Edit helpers ----------
  const startEdit = (med) => {
    setIsEditing(true);
    setEditingId(med.id);
    setNewMed({
      name: med.name || '',
      dosage: med.dosage || '',
      time: med.time || '',
      frequency: med.frequency || 'Daily',
      days: med.days || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
      pillsRemaining: typeof med.pillsRemaining === 'number' ? med.pillsRemaining : DEFAULT_REFILL.pillsRemaining,
      pillsPerDose: typeof med.pillsPerDose === 'number' ? med.pillsPerDose : DEFAULT_REFILL.pillsPerDose,
      refillThreshold: typeof med.refillThreshold === 'number' ? med.refillThreshold : DEFAULT_REFILL.refillThreshold,
    });
    setCurrentView('addMed');
  };

  const openAdd = () => {
    setIsEditing(false);
    setEditingId(null);
    setNewMed(EMPTY_MED);
    setCurrentView('addMed');
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditingId(null);
    setNewMed(EMPTY_MED);
    setCurrentView('dashboard');
  };

  // ---------- Medication actions ----------
  const toggleMedication = async (id) => {
    const key = todayKey();

    const current = medications.find(m => String(m.id) === String(id));
    const wasTaken = !!current?.takenLog?.[key];
    const willBeTaken = !wasTaken;

    const pillsRemainingNow =
      typeof current?.pillsRemaining === 'number' ? current.pillsRemaining : DEFAULT_REFILL.pillsRemaining;

    const pillsPerDoseNow =
      typeof current?.pillsPerDose === 'number' ? current.pillsPerDose : DEFAULT_REFILL.pillsPerDose;

    const newPillsRemaining = willBeTaken
      ? Math.max(pillsRemainingNow - pillsPerDoseNow, 0)
      : pillsRemainingNow;

    setMedications(meds =>
      meds.map(med => {
        if (String(med.id) !== String(id)) return med;

        const updatedLog = {
          ...(med.takenLog || {}),
          [key]: !med?.takenLog?.[key]
        };

        return {
          ...med,
          takenLog: updatedLog,
          pillsRemaining: newPillsRemaining,
        };
      })
    );

    if (isTest || !user) return;

    const updatedLog = {
      ...(current?.takenLog || {}),
      [key]: !current?.takenLog?.[key]
    };

    const ref = doc(db, 'users', user.uid, 'medications', String(id));
    await updateDoc(ref, {
      takenLog: updatedLog,
      pillsRemaining: newPillsRemaining,
    });
  };

  const saveMedication = async () => {
    if (!newMed.name || !newMed.dosage || !newMed.time) return;

    const allDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const daysSafe =
      String(newMed.frequency).toLowerCase() === 'daily'
        ? allDays
        : (Array.isArray(newMed.days) && newMed.days.length ? newMed.days : allDays);

    const normalized = {
      ...newMed,
      days: daysSafe,
      pillsRemaining: Math.max(0, Number(newMed.pillsRemaining ?? 30)),
      pillsPerDose: Math.max(1, Number(newMed.pillsPerDose ?? 1)),
      refillThreshold: Math.max(0, Number(newMed.refillThreshold ?? 5)),
    };

    if (isTest || !user) {
      if (isEditing && editingId != null) {
        setMedications(meds =>
          meds.map(m => (String(m.id) === String(editingId) ? { ...m, ...normalized } : m))
        );
      } else {
        setMedications(meds => [...meds, { id: Date.now(), ...normalized, takenLog: {} }]);
      }
      cancelEdit();
      return;
    }

    if (isEditing && editingId != null) {
      const ref = doc(db, 'users', user.uid, 'medications', String(editingId));
      await updateDoc(ref, { ...normalized });

      setMedications(meds =>
        meds.map(m => (String(m.id) === String(editingId) ? { ...m, ...normalized } : m))
      );
    } else {
      const medsRef = collection(db, 'users', user.uid, 'medications');
      const docRef = await addDoc(medsRef, { ...normalized, takenLog: {} });
      setMedications(meds => [...meds, { id: docRef.id, ...normalized, takenLog: {} }]);
    }

    cancelEdit();
  };

  const deleteMedication = async (id) => {
    const ok = window.confirm('Delete this medication?');
    if (!ok) return;

    setMedications(meds => meds.filter(m => String(m.id) !== String(id)));

    if (isEditing && String(editingId) === String(id)) {
      setIsEditing(false);
      setEditingId(null);
      setNewMed(EMPTY_MED);
      setCurrentView('dashboard');
    }

    if (isTest || !user) return;

    const ref = doc(db, 'users', user.uid, 'medications', String(id));
    await deleteDoc(ref);
  };

  const toggleDay = (day) => {
    setNewMed(state => ({
      ...state,
      days: state.days.includes(day)
        ? state.days.filter(d => d !== day)
        : [...state.days, day],
    }));
  };

  const getTodaysMedications = () => {
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const todayName = dayNames[new Date().getDay()];

    return medications
      .filter(med => {
        if (String(med.frequency || '').toLowerCase() === 'daily') return true;
        const days = Array.isArray(med.days) ? med.days : [];
        return days.includes(todayName);
      })
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  };

  // ---------- Caregiver ----------
  const saveCaregiver = async () => {
    setCaregiverStatus({ loading: true, error: '', saved: '' });

    const payload = {
      name: String(caregiver.name || '').trim(),
      relationship: String(caregiver.relationship || '').trim(),
      phone: String(caregiver.phone || '').trim(),
      email: String(caregiver.email || '').trim(),
      notes: String(caregiver.notes || '').trim(),
    };

    if (!payload.name || !payload.phone) {
      setCaregiverStatus({ loading: false, error: 'Caregiver name + phone are required.', saved: '' });
      return;
    }

    if (isTest || !user) {
      setCaregiver(payload);
      setCaregiverStatus({ loading: false, error: '', saved: 'Saved.' });
      return;
    }

    try {
      const ref = doc(db, 'users', user.uid, 'caregiver', 'main');
      await setDoc(ref, payload, { merge: true });
      setCaregiverStatus({ loading: false, error: '', saved: 'Saved.' });
    } catch (e) {
      setCaregiverStatus({ loading: false, error: e?.message || 'Failed to save caregiver.', saved: '' });
    }
  };

  // ---------- Preferred pharmacy ----------
  const choosePharmacy = async (p) => {
    setSelectedPharmacy(p);
    setPharmacyPickStatus({ loading: true, error: '', saved: '' });

    const payload = {
      id: p.id || p.osmId || 'selected',
      osmId: p.osmId || p.id || '',
      name: p.name || '',
      phone: p.phone || '',
      address: p.address || '',
      hours: p.hours || '',
      lat: typeof p.lat === 'number' ? p.lat : null,
      lng: typeof p.lng === 'number' ? p.lng : null,
      source: p.source || 'openstreetmap_overpass',
    };

    if (isTest || !user) {
      setPharmacyPickStatus({ loading: false, error: '', saved: 'Preferred pharmacy saved.' });
      return;
    }

    try {
      const ref = doc(db, 'users', user.uid, 'selectedPharmacy', 'main');
      await setDoc(ref, payload, { merge: true });
      setPharmacyPickStatus({ loading: false, error: '', saved: 'Preferred pharmacy saved.' });
    } catch (e) {
      setPharmacyPickStatus({ loading: false, error: e?.message || 'Failed to save preferred pharmacy.', saved: '' });
    }
  };

  const PharmacyCard = ({ p, showPick, isPreferred }) => {
    const hasAddress = p.address && String(p.address).trim().length > 0;
    const hasPhone = p.phone && String(p.phone).trim().length > 0;

    return (
      <div className={`pharmacy-card ${isPreferred ? 'pharmacy-card--preferred' : ''}`}>
        <div className="pharmacy-card__left">
          <div className="row center-y gap-sm">
            <div className="pharmacy-card__title">{p.name || 'Pharmacy'}</div>
            {isPreferred && <span className="badge badge--indigo">Preferred</span>}
          </div>

          {hasAddress && <div className="text-dim text-sm">{p.address}</div>}
          {hasPhone && <div className="text-dim text-sm">{p.phone}</div>}
          {p.hours ? <div className="text-dim text-sm">{p.hours}</div> : null}

          {userLoc && p.distance != null && (
            <div className="text-dim text-sm">{p.distance.toFixed(1)} mi away</div>
          )}
        </div>

        <div className="pharmacy-card__right">
          <button className="btn btn--ghost" onClick={() => window.open(directionsUrlFor(p), '_blank')}>
            Get Directions
          </button>

          {showPick && (
            <button className="btn btn--primary" onClick={() => choosePharmacy(p)} disabled={pharmacyPickStatus.loading}>
              {pharmacyPickStatus.loading ? 'Saving…' : 'Set Preferred'}
            </button>
          )}
        </div>
      </div>
    );
  };

  // ---------- UI ----------
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand row center-y gap-sm">
          <Pill className="icon-xl accent" />
          <h1 className="brand__title">MedTrack</h1>
        </div>

        {isLoggedIn && (
          <div className="row center-y gap-md">
            <div className="row center-y gap-xs text-dim">
              <User className="icon-sm" />
              <span>{loggedInUser}</span>
            </div>
            <button onClick={handleLogout} className="btn btn--ghost row center-y gap-xs">
              <LogOut className="icon-sm" /> Logout
            </button>
          </div>
        )}
      </header>

      {!isLoggedIn ? (
        <main className="container">
          <section className="card card--elevated auth-card">
            <h2 className="section-title mb-sm">{authMode === 'login' ? 'Login' : 'Sign Up'}</h2>

            {authError && <div className="alert alert--error">{authError}</div>}

            <div className="stack-md">
              <div className="stack-sm">
                <label className="label">Email</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input"
                  placeholder="you@email.com"
                />
              </div>

              <div className="stack-sm">
                <label className="label">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="••••••••"
                />
              </div>

              {authMode === 'login' ? (
                <button onClick={handleLogin} className="btn btn--primary btn--block">Login</button>
              ) : (
                <button onClick={handleSignup} className="btn btn--primary btn--block">Create Account</button>
              )}

              {!isTest && (
                <button
                  type="button"
                  className="link"
                  onClick={() => setAuthMode(m => (m === 'login' ? 'signup' : 'login'))}
                >
                  {authMode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
                </button>
              )}
            </div>
          </section>
        </main>
      ) : (
        <main className="container grid">
          {/* NAV */}
          <aside className="sidebar">
            <button onClick={() => setCurrentView('dashboard')} className={`navbtn ${currentView === 'dashboard' ? 'navbtn--active' : ''}`}>
              <Clock className="icon-sm" /> Today
            </button>
            <button onClick={openAdd} className={`navbtn ${currentView === 'addMed' ? 'navbtn--active' : ''}`}>
              <Plus className="icon-sm" /> Add Med
            </button>
            <button onClick={() => setCurrentView('weekly')} className={`navbtn ${currentView === 'weekly' ? 'navbtn--active' : ''}`}>
              <Calendar className="icon-sm" /> Weekly
            </button>
            <button onClick={() => setCurrentView('pharmacies')} className={`navbtn ${currentView === 'pharmacies' ? 'navbtn--active' : ''}`}>
              <MapPin className="icon-sm" /> Pharmacies
            </button>
            <button onClick={() => setCurrentView('caregiver')} className={`navbtn ${currentView === 'caregiver' ? 'navbtn--active' : ''}`}>
              <HeartHandshake className="icon-sm" /> Caregiver
            </button>
          </aside>

          {/* MAIN */}
          <section className="content">
            {currentView === 'dashboard' && (
              <section className="card card--elevated">
                <div className="row between center-y mb-md">
                  <h2 className="section-title row center-y gap-xs">
                    <Clock className="icon-sm accent" /> Today&apos;s Medications
                  </h2>

                  <button className="btn btn--primary row center-y gap-xs" onClick={requestRefill}>
                    <Phone className="icon-sm" /> Request Refill
                  </button>
                </div>

                <div className="stack-md">
                  {getTodaysMedications().length === 0 ? (
                    <div className="empty-state">No medications scheduled for today.</div>
                  ) : (
                    getTodaysMedications().map((med) => {
                      const pillsRemaining =
                        typeof med.pillsRemaining === 'number' ? med.pillsRemaining : DEFAULT_REFILL.pillsRemaining;
                      const refillThreshold =
                        typeof med.refillThreshold === 'number' ? med.refillThreshold : DEFAULT_REFILL.refillThreshold;
                      const isLow = pillsRemaining <= refillThreshold;

                      return (
                        <div key={med.id} className={`med-row ${isTakenToday(med) ? 'med-row--taken' : ''}`}>
                          <div className="stack-xs">
                            <div className="row center-y gap-sm">
                              <h3 className={`med-name ${isTakenToday(med) ? 'text-success' : ''}`}>{med.name}</h3>
                              {isTakenToday(med) && <span className="badge badge--success">Taken</span>}
                              {isLow && <span className="badge badge--warning">Refill Soon</span>}
                            </div>

                            <div className="stack-xs text-dim">
                              <p className="text-sm"><span className="text-strong">Dosage:</span> {med.dosage}</p>
                              <p className="text-sm"><span className="text-strong">Time:</span> {med.time}</p>
                              <p className="text-sm"><span className="text-strong">Frequency:</span> {med.frequency}</p>
                              <p className="text-sm"><span className="text-strong">Pills left:</span> {pillsRemaining}</p>
                            </div>
                          </div>

                          <div className="row center-y gap-sm">
                            <button onClick={() => startEdit(med)} className="btn btn--ghost">Edit</button>
                            <button onClick={() => deleteMedication(med.id)} className="btn btn--ghost">Delete</button>
                            <button
                              onClick={() => toggleMedication(med.id)}
                              className={`btn-circle ${isTakenToday(med) ? 'btn-circle--success' : 'btn-circle--primary'}`}
                              aria-label="Toggle taken"
                            >
                              <Check className="icon-sm icon--on-dark" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            )}

            {currentView === 'addMed' && (
              <section className="card card--elevated">
                <div className="row between center-y mb-md">
                  <h2 className="section-title row center-y gap-xs">
                    <Plus className="icon-sm accent" /> {isEditing ? 'Edit Medication' : 'Add Medication'}
                  </h2>

                  {isEditing ? (
                    <button onClick={cancelEdit} className="btn btn--ghost">Cancel</button>
                  ) : (
                    <button onClick={() => setCurrentView('dashboard')} className="btn btn--ghost">← Back</button>
                  )}
                </div>

                <div className="stack-md">
                  <div className="stack-sm">
                    <label className="label">Medication Name</label>
                    <input
                      value={newMed.name}
                      onChange={(e) => setNewMed({ ...newMed, name: e.target.value })}
                      className="input"
                      placeholder="e.g. Aspirin"
                    />
                  </div>

                  <div className="stack-sm">
                    <label className="label">Dosage</label>
                    <input
                      value={newMed.dosage}
                      onChange={(e) => setNewMed({ ...newMed, dosage: e.target.value })}
                      className="input"
                      placeholder="e.g. 100mg"
                    />
                  </div>

                  <div className="stack-sm">
                    <label className="label">Time</label>
                    <input
                      type="time"
                      value={newMed.time}
                      onChange={(e) => setNewMed({ ...newMed, time: e.target.value })}
                      className="input"
                    />
                  </div>

                  <div className="stack-sm">
                    <label className="label">Frequency</label>
                    <select
                      value={newMed.frequency}
                      onChange={(e) => setNewMed({ ...newMed, frequency: e.target.value })}
                      className="input"
                    >
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>As Needed</option>
                    </select>
                  </div>

                  <div className="stack-sm">
                    <label className="label">Days of the Week</label>
                    <div className="chip-row">
                      {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleDay(day)}
                          className={`chip ${newMed.days.includes(day) ? 'chip--active' : ''}`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                    <div className="text-dim text-sm">Tip: “Daily” ignores day selection and always shows.</div>
                  </div>

                  <div className="grid-3">
                    <div className="stack-sm">
                      <label className="label">Pills Remaining</label>
                      <input
                        type="number"
                        className="input"
                        value={newMed.pillsRemaining}
                        onChange={(e) => setNewMed({ ...newMed, pillsRemaining: e.target.value })}
                        min={0}
                      />
                    </div>

                    <div className="stack-sm">
                      <label className="label">Pills Per Dose</label>
                      <input
                        type="number"
                        className="input"
                        value={newMed.pillsPerDose}
                        onChange={(e) => setNewMed({ ...newMed, pillsPerDose: e.target.value })}
                        min={1}
                      />
                    </div>

                    <div className="stack-sm">
                      <label className="label">Refill Threshold</label>
                      <input
                        type="number"
                        className="input"
                        value={newMed.refillThreshold}
                        onChange={(e) => setNewMed({ ...newMed, refillThreshold: e.target.value })}
                        min={0}
                      />
                    </div>
                  </div>

                  <button onClick={saveMedication} className="btn btn--primary btn--block">
                    {isEditing ? 'Save Changes' : 'Add Medication'}
                  </button>
                </div>
              </section>
            )}

            {currentView === 'weekly' && (
              <section className="card card--elevated">
                <div className="row between center-y mb-md">
                  <h2 className="section-title row center-y gap-xs">
                    <Calendar className="icon-sm accent" /> Weekly Medication Schedule
                  </h2>
                  <button onClick={() => setCurrentView('dashboard')} className="btn btn--ghost">← Back</button>
                </div>

                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Medication</th>
                        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => (
                          <th key={day} className="text-center">{day}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const keys = weekDateKeys();
                        const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

                        return medications.map((med) => (
                          <tr key={med.id}>
                            <td>
                              <div className="stack-xxs">
                                <p className="text-strong">{med.name}</p>
                                <p className="text-dim text-sm">{med.dosage} at {med.time}</p>
                              </div>
                            </td>

                            {dayLabels.map((label, idx) => {
                              const dateKey = keys[idx];
                              const taken = !!med?.takenLog?.[dateKey];

                              return (
                                <td key={label} className="text-center">
                                  {taken ? <span className="badge badge--success">✓</span> : <span className="text-faint">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {currentView === 'pharmacies' && (
              <section className="card card--elevated">
                <div className="row between center-y mb-md">
                  <h2 className="section-title row center-y gap-xs">
                    <MapPin className="icon-sm accent" /> Pharmacies (OpenStreetMap)
                  </h2>
                  <div className="row center-y gap-sm">
                    <button className="btn btn--primary row center-y gap-xs" onClick={requestRefill}>
                      <Phone className="icon-sm" /> Request Refill
                    </button>
                    <button onClick={() => setCurrentView('dashboard')} className="btn btn--ghost">← Back</button>
                  </div>
                </div>

                {/* Preferred pharmacy displayed as a normal card */}
                {selectedPharmacy && (
                  <div className="stack-sm" style={{ marginBottom: 14 }}>
                    <div className="text-dim text-sm">Preferred pharmacy</div>
                    <PharmacyCard p={selectedPharmacy} showPick={false} isPreferred />
                  </div>
                )}

                {pharmacyPickStatus.saved && <div className="alert">{pharmacyPickStatus.saved}</div>}
                {pharmacyPickStatus.error && <div className="alert alert--error">{pharmacyPickStatus.error}</div>}

                <div className="stack-md">
                  <div className="row gap-sm wrap">
                    <div className="input-wrap">
                      <Search className="input-wrap__icon icon-sm" />
                      <input
                        className="input input--with-icon"
                        placeholder="Search pharmacies by name or address..."
                        value={pharmacyQuery}
                        onChange={(e) => setPharmacyQuery(e.target.value)}
                      />
                    </div>

                    <select
                      className="input"
                      value={radiusKm}
                      onChange={(e) => setRadiusKm(Number(e.target.value))}
                      style={{ width: 160 }}
                    >
                      <option value={1}>Radius: 1 km</option>
                      <option value={5}>Radius: 5 km</option>
                      <option value={10}>Radius: 10 km</option>
                    </select>

                    <button
                      className="btn btn--primary"
                      onClick={refreshRealPharmacies}
                      disabled={pharmacyStatus.loading}
                    >
                      {pharmacyStatus.loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>

                  {locError && <div className="alert alert--error">{locError}</div>}
                  {pharmacyStatus.error && <div className="alert alert--error">{pharmacyStatus.error}</div>}

                  {userLoc && <div className="text-dim text-sm">Location enabled — showing closest first.</div>}

                  <div className="text-dim text-sm">
                    Loaded pharmacies: {pharmacies.length} | Showing: {visiblePharmacies.length}
                  </div>

                  <div className="stack-md">
                    {visiblePharmacies.length === 0 ? (
                      <div className="empty-state">No pharmacies found. Try a different search or increase radius.</div>
                    ) : (
                      visiblePharmacies.map((p) => (
                        <PharmacyCard
                          key={p.id}
                          p={p}
                          showPick
                          isPreferred={selectedPharmacy?.id === p.id || selectedPharmacy?.osmId === p.osmId}
                        />
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}

            {currentView === 'caregiver' && (
              <section className="card card--elevated">
                <div className="row between center-y mb-md">
                  <h2 className="section-title row center-y gap-xs">
                    <HeartHandshake className="icon-sm accent" /> Caregiver Contact
                  </h2>
                  <button onClick={() => setCurrentView('dashboard')} className="btn btn--ghost">← Back</button>
                </div>

                <div className="stack-md">
                  <div className="grid-2">
                    <div className="stack-sm">
                      <label className="label">Caregiver Name</label>
                      <input
                        className="input"
                        value={caregiver.name}
                        onChange={(e) => setCaregiver({ ...caregiver, name: e.target.value })}
                        placeholder="e.g. Maria Lopez"
                      />
                    </div>

                    <div className="stack-sm">
                      <label className="label">Relationship</label>
                      <input
                        className="input"
                        value={caregiver.relationship}
                        onChange={(e) => setCaregiver({ ...caregiver, relationship: e.target.value })}
                        placeholder="e.g. Daughter, Neighbor, Nurse"
                      />
                    </div>
                  </div>

                  <div className="grid-2">
                    <div className="stack-sm">
                      <label className="label">Phone Number</label>
                      <input
                        className="input"
                        value={caregiver.phone}
                        onChange={(e) => setCaregiver({ ...caregiver, phone: e.target.value })}
                        placeholder="e.g. (555) 123-4567"
                      />
                    </div>

                    <div className="stack-sm">
                      <label className="label">Email</label>
                      <input
                        className="input"
                        value={caregiver.email}
                        onChange={(e) => setCaregiver({ ...caregiver, email: e.target.value })}
                        placeholder="optional"
                      />
                    </div>
                  </div>

                  <div className="stack-sm">
                    <label className="label">Notes</label>
                    <input
                      className="input"
                      value={caregiver.notes}
                      onChange={(e) => setCaregiver({ ...caregiver, notes: e.target.value })}
                      placeholder="optional notes (best time to call, etc.)"
                    />
                  </div>

                  {caregiverStatus.error && <div className="alert alert--error">{caregiverStatus.error}</div>}
                  {caregiverStatus.saved && <div className="alert">{caregiverStatus.saved}</div>}

                  <div className="row gap-sm wrap">
                    <button className="btn btn--primary" onClick={saveCaregiver} disabled={caregiverStatus.loading}>
                      {caregiverStatus.loading ? 'Saving…' : 'Save Caregiver'}
                    </button>

                    <button
                      className="btn btn--ghost row center-y gap-xs"
                      onClick={() => callPhone(caregiver.phone)}
                      disabled={!normalizePhone(caregiver.phone)}
                      title={!normalizePhone(caregiver.phone) ? 'Add a phone number first' : 'Call caregiver'}
                    >
                      <Phone className="icon-sm" /> Call
                    </button>
                  </div>
                </div>
              </section>
            )}
          </section>
        </main>
      )}
    </div>
  );
};

export default MedTrack;
