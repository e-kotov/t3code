package expo.modules.t3citationpassage

internal class CitationPassageObservation(private val maxAttempts: Int = 60) {
  private var attempts = 0
  private var reportedRequest: Long? = null

  sealed interface Step {
    data object Wait : Step
    data class Complete(val report: CitationPassageLocation?, val emit: Boolean) : Step
  }

  fun begin() { attempts = 0 }

  fun update(requestId: Long, location: CitationPassageLocation?): Step {
    attempts += 1
    if (location == null && attempts < maxAttempts) return Step.Wait
    val emit = reportedRequest != requestId
    reportedRequest = requestId
    return Step.Complete(location, emit)
  }
}
