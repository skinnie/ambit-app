pragma Singleton
import QtQuick

// The offline half of Home's "Did you know?" card - André, 2026-08-12, on hearing the
// facts were online-only: "that is really what I want!" (a local base so the card works
// offline). Same contract as TotalsFacts.qml: the voice can be playful, the number cannot
// be invented - every line here is a well-established, checkable fact, leaning outdoors
// and navigation because that is this app's world. When the internet is reachable the
// card still prefers a fresh random fact from the API; this list is what keeps the card
// alive on a mountain with no signal, which is exactly where this app's user tends to be.
QtObject {
    id: root

    readonly property var facts: [
        qsTr("GPS satellites have to correct their clocks for Einstein's relativity - "
             + "about 38 microseconds a day, or your position would drift by kilometres."),
        qsTr("An Arctic tern flies roughly 70,000 km a year, pole to pole and back - "
             + "the longest migration of any animal."),
        qsTr("Mount Everest is still growing - the tectonic push that built it lifts it "
             + "about 4 mm every year."),
        qsTr("The Challenger Deep is deeper than Everest is tall: sink the mountain in "
             + "it and the summit would sit over 2 km underwater."),
        qsTr("Bar-headed geese migrate directly over the Himalaya, flying where the air "
             + "holds a third of the oxygen at sea level."),
        qsTr("Lightning strikes the Earth about eight million times a day - roughly a "
             + "hundred strikes every second."),
        qsTr("The Sahara was green savanna with lakes and hippos as recently as 6,000 "
             + "years ago."),
        qsTr("Bamboo is the fastest-growing plant on Earth - some species add close to "
             + "90 cm in a single day."),
        qsTr("A blue whale's heart weighs about 180 kg and beats as slowly as twice a "
             + "minute on a deep dive."),
        qsTr("Honey never spoils - archaeologists have found still-edible honey in "
             + "Egyptian tombs over 3,000 years old."),
        qsTr("Olympus Mons on Mars is about two and a half times the height of Everest, "
             + "and you could walk up it: the slope averages only 5 degrees."),
        qsTr("Trees in a forest trade sugar and warning signals through underground "
             + "fungal networks connecting their roots."),
        qsTr("A monarch butterfly weighing half a gram migrates up to 4,800 km - and the "
             + "one that arrives is the great-grandchild of the one that left."),
        qsTr("A day on Venus is longer than its year: it spins slower than it orbits "
             + "the Sun."),
        qsTr("Sweat has no smell at all - the odour is made by bacteria eating it, "
             + "which is why fresh sweat on a climb smells of nothing."),
        qsTr("The General Sherman sequoia is the largest living tree on Earth by "
             + "volume - about 1,487 cubic metres of trunk."),
        qsTr("Sound carries about four times faster underwater than in air - whales "
             + "can hear each other across entire ocean basins."),
        qsTr("The Alps are still rising a millimetre or two per year - and erosion is "
             + "tearing them down at almost the same rate."),
    ]

    // No immediate repeats, otherwise "Another ›" can serve the same fact twice in a row
    // and look broken.
    property int _last: -1

    function random() {
        if (facts.length === 0)
            return ""
        let i = Math.floor(Math.random() * facts.length)
        if (facts.length > 1 && i === _last)
            i = (i + 1) % facts.length
        _last = i
        return facts[i]
    }
}
