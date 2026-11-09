// Types for the data model, as JSDoc, so editors and `tsc -p jsconfig.json` can check the library.
// This file has no code; the other modules refer to these types with import("./types.js").
export {};

/**
 * @typedef {{ min: number, day: number, text: string }} Time
 *   a time at a station: minutes after midnight, days after the train left its first station, and "HH:MM"
 *
 * @typedef {object} Station
 * @property {string} code
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {boolean} approx       the position is approximate
 * @property {string} state
 * @property {Route[]} routes       routes that call here, by number
 * @property {boolean} term         a route starts or ends here
 * @property {number} [pairs]
 * @property {{ code: string, km: number }[]} [near]  stations within reach by road, for a change of station
 *
 * @typedef {object} Route
 * @property {number} id
 * @property {string} n             the train numbers, "22435/22436", pairs joined by " · "
 * @property {string[]} nums
 * @property {string} label
 * @property {string} type          "cc" (chair car) or "sleeper"
 * @property {string[]} stops       station codes in order
 * @property {string} note
 * @property {Set<string>} unc      halts some timetables leave out
 * @property {number} km            length by rail
 * @property {number[] | null} k    distance by rail from the first stop to each stop
 * @property {number} first
 * @property {Set<string>} numbers
 * @property {number[]} [cum]
 * @property {Map<string, number>} [index]  station code -> position in stops
 *
 * @typedef {object} Train
 * @property {string} num
 * @property {Route} route
 * @property {string} from
 * @property {string} to
 * @property {boolean | null} forward  runs in the order of the route's stops
 * @property {string[]} days         days it leaves its first station: "Sun" … "Sat"
 * @property {Record<string, { arr: Time | null, dep: Time | null }>} times
 * @property {string[]} src          where the timetable was checked
 * @property {string} checked        when, as YYYY-MM-DD
 * @property {string} [note]
 * @property {boolean} [sleeper]
 *
 * @typedef {object} Place
 * @property {string} id
 * @property {string} name
 * @property {string} state
 * @property {string[]} codes        its Vande Bharat stations
 * @property {string[]} see
 * @property {string} tip
 * @property {string} months         twelve digits, January first: 2 good, 1 fair, 0 better avoided
 * @property {number} [lat]
 * @property {number} [lon]
 *
 * @typedef {object} Network
 * @property {Map<string, Station>} ST
 * @property {Route[]} ROUTES
 * @property {Map<string, Train>} TRAINS
 * @property {Map<number, Train[]>} trainsByRoute
 * @property {Map<string, Place>} PLACES
 * @property {Map<string, Place>} placeByCode
 * @property {string} checked
 *
 * @typedef {object} RailLeg
 * @property {"rail"} kind
 * @property {Route} route
 * @property {Train} [train]
 * @property {string} from
 * @property {string} to
 * @property {number} i               position of from in the route's stops
 * @property {number} j               position of to
 * @property {number} halts
 * @property {number} km
 * @property {number} [start]         dated journeys: the day the train left its first station
 * @property {number | Time} [dep]    dated journeys: minutes from midnight on the day asked; otherwise the time
 * @property {number | Time} [arr]
 *
 * @typedef {{ kind: "road", from: string, to: string, km: number }} RoadLeg
 *
 * @typedef {object} DatedJourney
 * @property {(RailLeg | RoadLeg)[]} legs
 * @property {number} dep             minutes from midnight on the day asked
 * @property {number} arr
 * @property {number} trains
 * @property {number} changes
 * @property {number} km
 * @property {number} roadKm
 * @property {number} nights
 *
 * @typedef {{ place: string, nights: number }} OwnStop
 */
